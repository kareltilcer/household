// Package tenant holds a household-scoped request to its household (PRD 01 §2.2, D-2, D-4).
// Its middleware resolves {household_id} from the path, checks that the caller holds a
// membership there, and resolves the caller's effective level on each module the household
// enables (PRD 01 §5). Handlers then read the database through InTx, and write it through the
// mutation spine, whose every transaction carries the household and the caller to PostgreSQL,
// where row-level security holds each query to them.
//
// A transaction is a unit of work that InTx opens and commits before the handler answers, not
// one transaction held for the whole request: that one would commit after the response had
// told the client its write succeeded, and would hold a pooled connection through every slow
// call the handler makes (ADR 0005).
package tenant

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// Param is the path parameter that names the household, as the contract declares it.
const Param = "household_id"

// ErrNoTenant is InTx's answer, and grant's, outside a household-scoped request: a bug in the
// caller, since only a route mounted behind the middleware has a household to carry.
var ErrNoTenant = errors.New("tenant: no household in this context")

// errNotMember is the resolution's answer for a caller who holds no membership in the
// household, or a household that does not exist; the two are one answer (D-16).
var errNotMember = errors.New("tenant: not a member")

// Beginner opens transactions: a pool connected as the request role.
type Beginner interface {
	BeginTx(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error)
}

// Scope is the resolved tenant of one request: the household, the caller, their role there, their
// effective level on each module, and the household's entitlement.
type Scope struct {
	householdID uuid.UUID
	userID      uuid.UUID
	role        access.Role
	levels      map[string]access.Level
	entitlement entitlement.Status
	pool        Beginner
}

type scopeKey struct{}

// From returns the scope ctx carries, or nil outside a household-scoped request.
func From(ctx context.Context) *Scope {
	s, _ := ctx.Value(scopeKey{}).(*Scope)
	return s
}

// HouseholdID returns the household the request addresses.
func (s *Scope) HouseholdID() uuid.UUID { return s.householdID }

// UserID returns the caller.
func (s *Scope) UserID() uuid.UUID { return s.userID }

// Role returns the caller's role in the household.
func (s *Scope) Role() access.Role { return s.role }

// Level returns the caller's effective level on module: None for a module the household does
// not enable, and for one it has no row for. grant.Require is how a handler asks.
func (s *Scope) Level(module string) access.Level { return s.levels[module] }

// Entitlement returns the household's entitlement as the request found it, resolved once per request
// (PRD 04 §3): the zero Status, which reads as trialing, in a scope the middleware did not resolve
// (Assume).
func (s *Scope) Entitlement() entitlement.Status { return s.entitlement }

// Assume returns ctx carrying the scope of household for user, whose role there is role, without
// the membership check the middleware makes: the scope through which the platform reads and
// writes a household the caller holds no membership in, or none yet, once something else has
// proved their right to, as creating a household, or holding its invitation, does (plan item 10).
// The scope resolves no module levels, so grant.Require refuses every module in it. user is
// uuid.Nil for a caller who is not signed in, whose transactions carry no caller.
//
// A module never calls it, since a module's routes are behind the middleware, and a scope it made
// itself would read and write whichever household it named: architecture test 4 fails a module
// that does.
func Assume(ctx context.Context, pool Beginner, household, user uuid.UUID, role access.Role) context.Context {
	return context.WithValue(ctx, scopeKey{}, &Scope{
		householdID: household, userID: user, role: role, levels: map[string]access.Level{}, pool: pool,
	})
}

// InTx runs fn in a read-only transaction of ctx's household, and commits it when fn returns
// nil; an error or a panic rolls it back. The transaction runs as the request role, with the
// household and the caller set for as long as it lasts (SET LOCAL), so a query in fn that
// forgets its WHERE household_id reads only this household's rows, and the connection goes back
// to the pool with neither set. Outside a household-scoped request InTx returns ErrNoTenant
// without running fn.
//
// It is read-only because every write goes through the mutation spine, which records the audit
// event and the sync change in the write's own transaction (PRD 01 §3): PostgreSQL refuses an
// INSERT, UPDATE or DELETE here, so a handler cannot write around the spine by accident.
func InTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return inTx(ctx, pgx.ReadOnly, fn)
}

// InWriteTx is InTx for a transaction that may write: a row written for another household is
// refused by row-level security. Only the platform calls it: the mutation spine, for every
// mutation, and the platform's own bookkeeping, such as idempotency keys. Architecture test 4
// fails a module that does, since a module's write that bypassed the spine would commit
// without its audit event and its sync change.
func InWriteTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return inTx(ctx, pgx.ReadWrite, fn)
}

// AccountTx runs fn in a transaction outside any household, with user as the caller (uuid.Nil for
// none), and commits it when fn returns nil: the work of a request about an account rather than a
// household, its credentials, its sessions and its profile, whose tables are global (PRD 01 §2.4).
// It runs as the request role with no household set, so row-level security admits no household's
// rows: a tenant table reads nothing and refuses every write, and households and memberships admit
// only the caller's own, for reading.
func AccountTx(ctx context.Context, pool Beginner, user uuid.UUID, fn func(pgx.Tx) error) error {
	caller := ""
	if user != uuid.Nil {
		caller = user.String()
	}
	return pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		if err := enter(ctx, tx, "", caller); err != nil {
			return err
		}
		return fn(tx)
	})
}

// Outside runs fn in tx, a transaction of ctx's household, with the household taken out of its
// context and the caller left in it, then puts the household back, whether fn failed or not: what
// the caller reads of their own memberships and of the households they are in, which row-level
// security admits outside any household alone, read in the transaction that writes, so that a lock
// it holds covers the read too, as the households a user may own are counted where one is created
// (fair use). Nothing else is admitted there: a tenant table reads nothing and refuses every write,
// as in AccountTx. fn's error is returned before one putting the household back met.
func Outside(ctx context.Context, tx pgx.Tx, fn func() error) error {
	s := From(ctx)
	if s == nil {
		return ErrNoTenant
	}
	user := ""
	if s.userID != uuid.Nil {
		user = s.userID.String()
	}
	if err := enter(ctx, tx, "", user); err != nil {
		return err
	}
	err := fn()
	if back := enter(ctx, tx, s.householdID.String(), user); err == nil {
		err = back
	}
	return err
}

func inTx(ctx context.Context, mode pgx.TxAccessMode, fn func(pgx.Tx) error) error {
	s := From(ctx)
	if s == nil {
		return ErrNoTenant
	}
	// A scope with no caller, the system's, carries none, so that app_user_id() is NULL and the
	// base columns record nobody (add_entity_columns) rather than the zero UUID, which is no user.
	user := ""
	if s.userID != uuid.Nil {
		user = s.userID.String()
	}
	return pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{AccessMode: mode}, func(tx pgx.Tx) error {
		if err := enter(ctx, tx, s.householdID.String(), user); err != nil {
			return err
		}
		return fn(tx)
	})
}

// enter carries a household and a caller into tx until it ends: the request role, and the two
// settings the policies read, household "" for none. set_config(…, true) is SET LOCAL with
// the values bound as parameters rather than spliced into the statement. Setting the role
// matters only for a pool that connected as a role above the request role, a superuser, which
// would otherwise pass every policy: config refuses to serve as one, and this refuses to query
// as one.
func enter(ctx context.Context, tx pgx.Tx, household, user string) error {
	_, err := tx.Exec(ctx,
		"SELECT set_config('role', $1, true), set_config('app.household_id', $2, true), set_config('app.user_id', $3, true)",
		db.RoleApp, household, user)
	return err
}

// Config is what the middleware needs.
type Config struct {
	// Pool opens the transactions, connected as the request role.
	Pool Beginner
	// Logger records a resolution that failed.
	Logger *slog.Logger
	// Entitlement is asked once the tenant is resolved whether the household's entitlement state
	// permits the request (FR-BI1, entitlement.Gate), with the scope, its entitlement among it, in
	// the request's context. The request goes on when it returns nil and is answered with the
	// problem it returns otherwise, or with 500 for an error that is not a problem. Nil asks
	// nothing.
	Entitlement func(*http.Request) error
}

// Middleware returns the tenant middleware, for the router mounted at
// /households/{household_id}. It answers 401 unauthenticated to a request with no caller, and
// 404 not_found to one whose caller is not a member of the household, which is the same answer
// a household that does not exist gets (D-16).
func Middleware(cfg Config) (func(http.Handler) http.Handler, error) {
	if cfg.Pool == nil || cfg.Logger == nil {
		return nil, errors.New("tenant: the middleware needs a pool and a logger")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			requestID := reqctx.RequestID(ctx)
			user, ok := auth.User(ctx)
			if !ok {
				problem.Write(w, requestID, problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated))
				return
			}
			// The edge checks the parameter against the contract's Uuid on a route the contract
			// declares, but passes through a path no route matches, for the router to answer 404:
			// such a path reaches here with whatever the client put in it.
			household, err := uuid.Parse(chi.URLParam(r, Param))
			if err != nil {
				problem.Write(w, requestID, problem.NotFound())
				return
			}
			if rs := reqctx.From(ctx); rs != nil {
				rs.SetHouseholdID(household.String())
			}

			s, err := resolve(ctx, cfg.Pool, household, user)
			switch {
			case errors.Is(err, errNotMember):
				problem.Write(w, requestID, problem.NotFound())
				return
			case err != nil:
				cfg.Logger.LogAttrs(ctx, slog.LevelError, "tenant resolution failed", slog.Any("error", err))
				problem.Write(w, requestID, problem.Internal())
				return
			}
			r = r.WithContext(context.WithValue(ctx, scopeKey{}, s))

			if cfg.Entitlement != nil {
				if err := cfg.Entitlement(r); err != nil {
					var p *problem.Problem
					if !errors.As(err, &p) {
						cfg.Logger.LogAttrs(ctx, slog.LevelError, "entitlement check failed", slog.Any("error", err))
					}
					problem.Write(w, requestID, err)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}, nil
}

// resolve returns user's scope in household, or errNotMember. The membership is read with only
// the caller in context, through the policy that lets a user read their own memberships; the
// household enters the context once the membership proves it, and its entitlement, its enablement
// and the caller's grants are read under the tenant policy.
func resolve(ctx context.Context, pool Beginner, household, user uuid.UUID) (*Scope, error) {
	s := &Scope{householdID: household, userID: user, levels: map[string]access.Level{}, pool: pool}
	err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if err := enter(ctx, tx, "", user.String()); err != nil {
			return err
		}
		var role string
		err := tx.QueryRow(ctx,
			"SELECT role::text FROM memberships WHERE household_id = $1 AND user_id = $2",
			household, user).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotMember
		}
		if err != nil {
			return err
		}
		if s.role, err = access.ParseRole(role); err != nil {
			return err
		}

		if err := enter(ctx, tx, household.String(), user.String()); err != nil {
			return err
		}
		var e entitlement.Row
		if err := tx.QueryRow(ctx, entitlement.Query, household).Scan(e.Dest()...); err != nil {
			return err
		}
		if s.entitlement, err = e.Status(); err != nil {
			return err
		}
		s.levels, err = Levels(ctx, tx, household, user, s.role)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s, nil
}

// Levels are user's effective levels on each of household's modules, whose role there is role
// (Effective), read in tx in household's context: what a request of theirs is allowed, and what the
// platform reads for them when it acts with no request, as a notification going out does (FR-NT5).
func Levels(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, role access.Role) (map[string]access.Level, error) {
	rows, err := tx.Query(ctx, `
		SELECT e.module, e.enabled, coalesce(g.level::text, 'none')
		FROM module_enablement e
		LEFT JOIN module_grants g
		  ON g.household_id = e.household_id AND g.module = e.module AND g.user_id = $2
		WHERE e.household_id = $1`, household, user)
	if err != nil {
		return nil, err
	}
	var (
		levels        = map[string]access.Level{}
		module, level string
		enabled       bool
	)
	_, err = pgx.ForEachRow(rows, []any{&module, &enabled, &level}, func() error {
		granted, err := access.ParseLevel(level)
		if err != nil {
			return err
		}
		levels[module] = Effective(role, module, enabled, granted)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return levels, nil
}

// Owners are household's owners, read in tx in its context, in the order of their ids: whom the
// platform tells of what is the owners' to act on, a child profile that locked, a ceiling of fair use
// nearing, a lapsed household's data about to be deleted.
func Owners(ctx context.Context, tx pgx.Tx, household uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, "SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'owner' ORDER BY user_id", household)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// Effective is a member's level on a module: the minimum of the household's enablement and the
// member's grant (PRD 01 §5). An owner has Manage on every enabled module and cannot be reduced
// (PRD modules/00 §2); a child is capped below Manage everywhere and at View on Finance,
// whatever their grant says (FR-AC4, access.Ceiling). The caps hold here as well as where a grant
// is written (item 10), so that no stored row lifts a child past them.
func Effective(role access.Role, module string, enabled bool, granted access.Level) access.Level {
	if !enabled {
		return access.None
	}
	if role == access.Owner {
		return access.Manage
	}
	return min(granted, access.Ceiling(role, module))
}
