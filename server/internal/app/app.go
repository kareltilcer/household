// Package app assembles the HTTP API from the platform and the modules the registry holds, and
// serves it.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/reference"
	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Accounts are the account surfaces (items 8 and 9): the identity service behind /auth and /me,
// the store that signs a web request in by its session cookie and the one that signs a device's in
// by its access token, the origins a browser's unsafe request may come from, the oldest client of
// each type served, and the API's limits per signed-in user and per household (PRD 02 §9).
type Accounts struct {
	Identity       *identity.Service
	Sessions       *session.Store
	Devices        *device.Store
	Origins        *session.Origins
	MinClients     clientversion.Minimums
	UserLimit      *ratelimit.Buckets
	HouseholdLimit *ratelimit.Buckets
}

// Deps are what the router's handlers need.
type Deps struct {
	Logger   *slog.Logger
	Contract *contract.Contract
	Health   *health.Health
	// Pool opens every transaction of a household-scoped request, connected as the request
	// role (tenant.InTx, and the mutation spine's tenant.InWriteTx).
	Pool tenant.Beginner
	// Meter is the meter role's pool, which counts a household's rows for the ceiling of fair use
	// the mutation spine holds each module to (storage.RowCeiling).
	Meter tenant.Beginner
	// Modules are the modules served, each under /households/{household_id}/<name>.
	Modules *module.Registry
	// Entitlement replaces the tenant middleware's entitlement gate (Gate) when not nil: a test's,
	// which asks what it wants of each household-scoped request.
	Entitlement func(*http.Request) error
	// MaxBodyBytes caps a JSON request body at the edge.
	MaxBodyBytes int64
	// BodyTimeout caps how long any request body may take to arrive, zero for no cap
	// (httpx.BodyDeadline).
	BodyTimeout time.Duration
	// Accounts are the account surfaces, every one of which the router needs.
	Accounts Accounts
	// Households is the household surface (item 10): households, their members, invitations and
	// modules.
	Households *household.Service
	// Sync is the sync surfaces (item 13), every one of which the router needs.
	Sync Sync
	// Storage is the storage picture (item 14). It labels the largest items by Modules when it names
	// no modules of its own.
	Storage *storage.Picture
	// Notify is the notification transport (item 15), whose routes are the caller's own: where their
	// browsers and devices are reached, and what they want to be told.
	Notify *notify.Service
}

// Sync is the sync surfaces (item 13, ADR 0014): the credentials a client's replica connects to
// PowerSync with and the keys PowerSync verifies them by, and the push's limit per device (PRD 02
// §9). The push itself is built from the module registry the router carries.
type Sync struct {
	Replica   *replica.Service
	PushLimit *ratelimit.Buckets
}

// Gate is FR-BI1's gate (entitlement.Gate), which the tenant middleware asks of every
// household-scoped request: the household's state as the middleware resolved it, the caller's role
// there, and the operation the contract's edge matched the request to.
func Gate(r *http.Request) error {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if scope == nil {
		return tenant.ErrNoTenant
	}
	operation := ""
	if op, ok := contract.OperationOf(ctx); ok {
		operation = op.ID
	}
	return entitlement.Gate(scope.Entitlement(), scope.Role(), operation, r.Method)
}

// Retract is the household surface's Lost hook (household.Hooks), which runs in the transaction of
// every change that takes access from members (PRD 03 §2.6, FR-SY7): a member removed from the
// household, or gone from it, leaves the readers of every row an audience of catalog's entities bounds
// (sync.RemoveReader, D-90). No other cause needs a write of its own: the streams read the grants, the
// modules' enablement and the memberships the change wrote, and a row that leaves every bucket a
// member holds leaves their replicas.
func Retract(catalog *module.Registry) func(context.Context, pgx.Tx, household.Loss) error {
	entities := catalog.Entities()
	return func(ctx context.Context, tx pgx.Tx, loss household.Loss) error {
		for member, modules := range loss.Members {
			if modules != nil {
				continue
			}
			if err := sync.RemoveReader(ctx, tx, entities, loss.Household, member); err != nil {
				return err
			}
		}
		return nil
	}
}

// NewRouter returns the server's whole HTTP surface: the platform middleware, and under
// contract.BasePath the contract's edge validation and every implemented route. It refuses
// to build with a route the contract does not declare, so the server never serves one.
//
// A client older than the oldest of its type served is answered please-update before anything else
// is asked of its request, the contract included (clientversion). Every unsafe request a browser
// sends from another site is refused before any route runs (session.Origins). The routes a person
// reaches before signing in are served as they arrive; every other route is behind the
// authentication, by an access token when the request carries one and by the session cookie when
// not, and the signed-in user's API limit, and one about the caller's own account, under /me and
// the rest of /auth, keeps its Idempotency-Key on the account, except those whose body carries a
// password (D-97). Beginning a sign-in with a provider is authenticated but needs no caller.
//
// The reference reads under /reference answer any authenticated caller, with no household, and the
// caller's own push subscriptions and notification preferences (item 15) are the account's routes.
//
// The household surface (item 10) is admin's, the module the platform serves itself, which the
// module registry the router carries declares beside the modules: a signed-in user's households,
// creating one and the invitations addressed to them sit beside the account's routes and keep their
// keys on the account; an invitation's preview is reached signed in or not; and a child profile's
// sign-in and the link that finishes its graduation (item 11) are reached before signing in, carrying
// the registry for the changes they record.
//
// PowerSync's keys under /sync/jwks answer anyone, PowerSync among them, which verifies with them
// the tokens a replica's credentials carry (item 13).
//
// Everything under /households/{household_id} passes the tenant middleware, which answers a
// caller who is not a member of the household before any route does, and carries the module
// registry the mutation spine checks each mutation against, and the household's API limit, which
// its members share. The household's own routes are there, behind the member's Idempotency-Key,
// but leaving, whose key is the account's and answers a repeat before the tenant middleware looks
// for the membership leaving ended: a member's keys go with their membership; and the two whose body
// carries a child profile's PIN, which keep none (D-97). A replica's credentials are there too, and
// keep no key either, since a credential is never kept to be answered with; and the push, behind
// the household's Idempotency-Key and the device's limit, which a web session's requests share as
// a device's do (PRD 02 §9). Each module's
// routes are mounted there at /<name>, behind the gate that answers 404 to a member who cannot see
// the module (PRD modules/00 §1), and behind the Idempotency-Key middleware, which answers a
// repeated unsafe request with its first response.
func NewRouter(d Deps) (*chi.Mux, error) {
	check := d.Entitlement
	if check == nil {
		check = Gate
	}
	tenancy, err := tenant.Middleware(tenant.Config{Pool: d.Pool, Logger: d.Logger, Entitlement: check})
	if err != nil {
		return nil, fmt.Errorf("app: %w", err)
	}
	a := d.Accounts
	if a.Identity == nil || a.Sessions == nil || a.Devices == nil || a.Origins == nil || a.UserLimit == nil || a.HouseholdLimit == nil {
		return nil, errors.New("app: the router needs every account surface")
	}
	if d.Households == nil {
		return nil, errors.New("app: the router needs the household surface")
	}
	if d.Sync.Replica == nil || d.Sync.PushLimit == nil {
		return nil, errors.New("app: the router needs every sync surface")
	}
	if d.Storage == nil {
		return nil, errors.New("app: the router needs the storage picture")
	}
	if d.Notify == nil {
		return nil, errors.New("app: the router needs the notification transport")
	}
	if d.Meter == nil {
		return nil, errors.New("app: the router needs the meter role's pool")
	}
	// The picture labels the largest items by the modules the router serves, unless it was given
	// others: without them it would name each by its file, whatever its module calls it.
	picture := *d.Storage
	if picture.Modules == nil {
		picture.Modules = d.Modules
	}
	registry, err := d.Modules.WithPlatform(household.Admin())
	if err != nil {
		return nil, fmt.Errorf("app: %w", err)
	}
	catalog := mutation.Catalog(registry)
	ceilings := mutation.Ceilings(storage.NewRowCeiling(d.Meter, d.Modules).Check)
	pushes, err := push.New(push.Config{Registry: registry, Logger: d.Logger, Notify: d.Notify})
	if err != nil {
		return nil, fmt.Errorf("app: %w", err)
	}
	reports, err := replica.NewReports(replica.ReportsConfig{Registry: registry, Logger: d.Logger})
	if err != nil {
		return nil, fmt.Errorf("app: %w", err)
	}
	// Behind the tenant middleware: a device's batches, or a web session's, share one budget.
	perDevice := ratelimit.Middleware(d.Sync.PushLimit, func(r *http.Request) (string, bool) {
		user, ok := auth.User(r.Context())
		if current, signedIn := device.From(r.Context()); signedIn {
			return "device:" + user.String() + ":" + current.Device.String(), ok
		}
		if sid, signedIn := session.Current(r.Context()); signedIn {
			return "session:" + sid.String(), ok
		}
		return "user:" + user.String(), ok
	})
	perUser := ratelimit.Middleware(a.UserLimit, func(r *http.Request) (string, bool) {
		user, ok := auth.User(r.Context())
		return user.String(), ok
	})
	// Behind the tenant middleware, so that only a member spends a household's budget.
	perHousehold := ratelimit.Middleware(a.HouseholdLimit, func(r *http.Request) (string, bool) {
		s := tenant.From(r.Context())
		if s == nil {
			return "", false
		}
		return s.HouseholdID().String(), true
	})

	root := chi.NewRouter()
	root.Use(httpx.RequestScope, httpx.AccessLog(d.Logger), httpx.Recover(d.Logger), httpx.BodyDeadline(d.BodyTimeout))
	root.NotFound(httpx.NotFound)
	root.MethodNotAllowed(httpx.MethodNotAllowed)

	api := chi.NewRouter()
	api.Use(clientversion.Middleware(a.MinClients), d.Contract.Middleware(api, contract.Limits{MaxBody: d.MaxBodyBytes}),
		a.Origins.Middleware)
	api.NotFound(httpx.NotFound)
	api.MethodNotAllowed(httpx.MethodNotAllowed)

	api.Get("/healthz", d.Health.Liveness)
	api.Get("/readyz", d.Health.Readiness)
	d.Sync.Replica.PublicRoutes(api)
	a.Identity.PublicRoutes(api)
	api.With(catalog).Group(d.Households.PublicRoutes)

	api.Group(func(signedIn chi.Router) {
		signedIn.Use(authenticate(a.Devices.Authenticate, a.Sessions.Authenticate), perUser)
		a.Identity.OptionalRoutes(signedIn)
		d.Households.OptionalRoutes(signedIn)
		signedIn.Route("/reference", reference.Routes(d.Pool, d.Logger))
		signedIn.Group(func(account chi.Router) {
			account.Use(auth.Required)
			a.Identity.PasswordRoutes(account)
			account.Group(func(keyed chi.Router) {
				keyed.Use(idempotency.AccountMiddleware(d.Pool, d.Logger, d.MaxBodyBytes))
				a.Identity.AccountRoutes(keyed)
				keyed.With(catalog).Group(d.Households.AccountRoutes)
				keyed.Group(d.Notify.AccountRoutes)
			})
		})
		// Leaving keeps its key on the account, found before the membership it ended is looked for,
		// so that a repeat is answered as the first request was rather than as a stranger.
		signedIn.With(auth.Required, idempotency.AccountMiddleware(d.Pool, d.Logger, d.MaxBodyBytes), tenancy, perHousehold, catalog, ceilings).
			Group(d.Households.LeaveRoutes)
		// A group rather than a router mounted at /households/{household_id}, whose mount point
		// would then be no route of its own (httpx.MountPoint): the household's own route is there.
		signedIn.Group(func(inHousehold chi.Router) {
			inHousehold.Use(tenancy, perHousehold, catalog, ceilings)
			inHousehold.With(idempotency.Middleware(d.Logger, d.MaxBodyBytes)).Group(d.Households.HouseholdRoutes)
			// A replica's credentials keep no key: a credential is never kept to be answered with.
			inHousehold.Group(d.Sync.Replica.HouseholdRoutes)
			inHousehold.With(idempotency.Middleware(d.Logger, d.MaxBodyBytes)).Group(reports.Routes)
			inHousehold.Group(picture.Routes)
			inHousehold.With(perDevice, idempotency.Middleware(d.Logger, d.MaxBodyBytes)).Group(pushes.Routes)
			// A child profile's PIN keeps no key, as a password does not (D-97).
			inHousehold.Group(d.Households.PINRoutes)
			for _, m := range d.Modules.All() {
				inHousehold.Route("/households/{"+tenant.Param+"}/"+m.Name(), func(r chi.Router) {
					r.Use(grant.Gate(m.Name()), idempotency.Middleware(d.Logger, d.MaxBodyBytes))
					m.RegisterRoutes(r)
				})
			}
		})
	})

	root.Mount(contract.BasePath, api)

	routes, err := contract.Routes(root)
	if err != nil {
		return nil, err
	}
	var undeclared []string
	for _, v := range d.Contract.Diff(routes, nil) {
		//nolint:exhaustive // The other kinds are architecture test 6's to report.
		switch v.Kind {
		case contract.OutsideBase, contract.Undeclared:
			undeclared = append(undeclared, v.String())
		}
	}
	if len(undeclared) > 0 {
		return nil, fmt.Errorf("app: %s", strings.Join(undeclared, "; "))
	}
	return root, nil
}

// authenticate signs a request in by its access token when its Authorization header carries a
// bearer token, which alone then decides, and by its session cookie when it does not (D-7): a
// request with a bearer token that authenticates no one is not signed in by a cookie it also
// carries. An Authorization header in another scheme is not the API's, such as the Basic
// credentials a browser resends to a proxy that asked for them, and leaves the cookie to decide.
func authenticate(bearer, cookie func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		byBearer, byCookie := bearer(next), cookie(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := device.Bearer(r); ok {
				byBearer.ServeHTTP(w, r)
				return
			}
			byCookie.ServeHTTP(w, r)
		})
	}
}

// Serve serves srv on ln until ctx ends, then stops accepting connections and waits up to
// timeout for requests in flight to finish. It returns nil after a clean shutdown.
func Serve(ctx context.Context, log *slog.Logger, srv *http.Server, ln net.Listener, timeout time.Duration) error {
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()

	select {
	case err := <-served:
		return fmt.Errorf("app: serve: %w", err)
	case <-ctx.Done():
	}

	log.LogAttrs(ctx, slog.LevelInfo, "shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		// Requests still running past the timeout are cut off.
		_ = srv.Close()
		return fmt.Errorf("app: shut down: %w", err)
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("app: serve: %w", err)
	}
	return nil
}

// NewServer returns the http.Server for handler. Reading a request's headers is bounded,
// against slow-loris clients. Reading a body and writing a response are not bounded here:
// an upload over a slow connection (item 14) legitimately takes minutes, which a server-wide
// timeout would cut off. A body is bounded per request instead, by httpx.BodyDeadline
// (Deps.BodyTimeout), which such a handler extends through http.ResponseController.
func NewServer(handler http.Handler, log *slog.Logger) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
}
