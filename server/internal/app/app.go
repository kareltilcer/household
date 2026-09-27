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

	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Deps are what the router's handlers need.
type Deps struct {
	Logger   *slog.Logger
	Contract *contract.Contract
	Health   *health.Health
	// Pool opens every transaction of a household-scoped request, connected as the request
	// role (tenant.InTx, and the mutation spine's tenant.InWriteTx).
	Pool tenant.Beginner
	// Modules are the modules served, each under /households/{household_id}/<name>.
	Modules *module.Registry
	// Entitlement is the tenant middleware's entitlement check (tenant.Config), nil until item
	// 18 fills it in.
	Entitlement func(*http.Request) error
	// MaxBodyBytes caps a JSON request body at the edge.
	MaxBodyBytes int64
	// BodyTimeout caps how long any request body may take to arrive, zero for no cap
	// (httpx.BodyDeadline).
	BodyTimeout time.Duration
}

// NewRouter returns the server's whole HTTP surface: the platform middleware, and under
// contract.BasePath the contract's edge validation and every implemented route. It refuses
// to build with a route the contract does not declare, so the server never serves one.
//
// Everything under /households/{household_id} passes the tenant middleware, which answers a
// caller who is not a member of the household before any route does, and carries the module
// registry the mutation spine checks each mutation against. Each module's routes are mounted
// below that at /<name>, behind the gate that answers 404 to a member who cannot see the module
// (PRD modules/00 §1), and behind the Idempotency-Key middleware, which answers a repeated
// unsafe request with its first response.
func NewRouter(d Deps) (*chi.Mux, error) {
	tenancy, err := tenant.Middleware(tenant.Config{Pool: d.Pool, Logger: d.Logger, Entitlement: d.Entitlement})
	if err != nil {
		return nil, fmt.Errorf("app: %w", err)
	}

	root := chi.NewRouter()
	root.Use(httpx.RequestScope, httpx.AccessLog(d.Logger), httpx.Recover(d.Logger), httpx.BodyDeadline(d.BodyTimeout))
	root.NotFound(httpx.NotFound)
	root.MethodNotAllowed(httpx.MethodNotAllowed)

	api := chi.NewRouter()
	api.Use(d.Contract.Middleware(api, contract.Limits{MaxBody: d.MaxBodyBytes}))
	api.NotFound(httpx.NotFound)
	api.MethodNotAllowed(httpx.MethodNotAllowed)

	api.Get("/healthz", d.Health.Liveness)
	api.Get("/readyz", d.Health.Readiness)

	api.Route("/households/{"+tenant.Param+"}", func(household chi.Router) {
		household.Use(tenancy, mutation.Catalog(d.Modules))
		for _, m := range d.Modules.All() {
			household.Route("/"+m.Name(), func(r chi.Router) {
				r.Use(grant.Gate(m.Name()), idempotency.Middleware(d.Logger))
				m.RegisterRoutes(r)
			})
		}
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
// an upload over a slow connection (item 16) and the sync stream (item 14) legitimately
// take minutes, which a server-wide timeout would cut off. A body is bounded per request
// instead, by httpx.BodyDeadline (Deps.BodyTimeout), which such a handler extends through
// http.ResponseController.
func NewServer(handler http.Handler, log *slog.Logger) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
}
