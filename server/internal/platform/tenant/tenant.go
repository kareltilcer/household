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

// Scope is the resolved tenant of one request: the household, the caller, their role there and
// their effective level on each module.
type Scope struct {
	householdID uuid.UUID
	userID      uuid.UUID
	role        access.Role
	levels      map[string]access.Level
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
	// Entitlement, when not nil, is asked once the tenant is resolved whether the household's
	// entitlement state permits the request (item 18). The request goes on when it returns nil
	// and is answered with the problem it returns otherwise, or with 500 for an error that is
	// not a problem.
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
// household enters the context once the membership proves it, and its enablement and the
// caller's grants are read under the tenant policy.
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
		rows, err := tx.Query(ctx, `
			SELECT e.module, e.enabled, coalesce(g.level::text, 'none')
			FROM module_enablement e
			LEFT JOIN module_grants g
			  ON g.household_id = e.household_id AND g.module = e.module AND g.user_id = $2
			WHERE e.household_id = $1`, household, user)
		if err != nil {
			return err
		}
		var (
			module, level string
			enabled       bool
		)
		_, err = pgx.ForEachRow(rows, []any{&module, &enabled, &level}, func() error {
			granted, err := access.ParseLevel(level)
			if err != nil {
				return err
			}
			s.levels[module] = effective(s.role, module, enabled, granted)
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return s, nil
}

// finance is the one module whose ceiling for a child is lower than every other's (FR-AC4).
const finance = "finance"

// effective is a member's level on a module: the minimum of the household's enablement and the
// member's grant (PRD 01 §5). An owner has Manage on every enabled module and cannot be reduced
// (PRD modules/00 §2); a child is capped below Manage everywhere and at View on Finance,
// whatever their grant says (FR-AC4). The caps hold here as well as where a grant is written
// (item 10), so that no stored row lifts a child past them.
func effective(role access.Role, module string, enabled bool, granted access.Level) access.Level {
	if !enabled {
		return access.None
	}
	switch role {
	case access.Owner:
		return access.Manage
	case access.Child:
		ceiling := access.Contribute
		if module == finance {
			ceiling = access.View
		}
		return min(granted, ceiling)
	case access.Member:
	}
	return granted
}
