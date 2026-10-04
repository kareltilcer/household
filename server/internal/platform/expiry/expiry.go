// Package expiry deletes what the platform keeps past its retention (PRD 03 §5): the expiry sweep,
// one job rather than one per table, since each row of the retention table is the same operation, and
// the hourly expiry of the single-use tokens and the invitations that no longer work. Its retentions
// are this file's table, row for row with PRD 03 §5's, so that a retention nobody decided shows as a
// row missing from both.
//
// The account tables are global (PRD 01 §2.4), and the request role deletes from them outside any
// household. A household's tables are read across households only by the meter role, which finds the
// households with something past its time, and each household's rows are deleted in its own context
// by the request role: no role both reads across households and writes, as the usage sampler does.
package expiry

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The retentions this package keeps (PRD 03 §5).
const (
	// Keys is how long an Idempotency-Key and a pushed mutation's answer are kept (FR-SY5, PRD 01 §6).
	Keys = 7 * 24 * time.Hour
	// UsedTokens is how long a used refresh token is kept, which tells a token presented again for a
	// theft (D-14): a month on, it no longer tells a theft from a stale token. A revoked device sign-in
	// is kept as long past its revocation, with its tokens.
	UsedTokens = 30 * 24 * time.Hour
	// Links is how long a link an email carried, to verify an address, reset a password or graduate,
	// is kept past its expiry, so that one opened late still answers that it expired.
	Links = 7 * 24 * time.Hour
	// Steps is how long a sign-in's second step and a provider's sign-in are kept past their end or
	// their expiry, for the same answer.
	Steps = 24 * time.Hour
	// UsageDays is how many UTC days past one the count of a household's pushed mutations on it is
	// kept: the fair-use ceiling reads only the day it is, and a week is what support asks about.
	UsageDays = 7
	// Replicas is how long a replica's last report is kept once it stops reporting (D-128): an app
	// uninstalled or a browser cleared never reports again, and the sync-health screen would list it
	// for as long as it was kept.
	Replicas = 90 * 24 * time.Hour
)

// Querier runs a query: the meter role's pool.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Config is what the sweeps need.
type Config struct {
	// Pool deletes, connected as the request role.
	Pool tenant.Beginner
	// Meter finds the households with rows past their time, connected as the meter role.
	Meter Querier
	Log   *slog.Logger
	// Invitations deletes every household's invitations that stopped working a month ago, through the
	// mutation spine (household.Service.PurgeInvitations), and returns how many.
	Invitations func(ctx context.Context) (int, error)
	// Exports removes the export archives past their seven days, and the rows of the exports that
	// ended a month ago (privacy.Service.Expire), and returns how many archives it removed.
	Exports func(ctx context.Context) (int, error)
}

// Sweeper runs the sweeps.
type Sweeper struct {
	cfg Config
}

// New returns the sweeper.
func New(cfg Config) (*Sweeper, error) {
	if cfg.Pool == nil || cfg.Meter == nil || cfg.Log == nil || cfg.Invitations == nil || cfg.Exports == nil {
		return nil, errors.New("expiry: the sweeper is missing a dependency")
	}
	return &Sweeper{cfg: cfg}, nil
}

// account is a retention on a global table: a statement the request role runs outside any household.
type account struct {
	what      string
	statement string
	args      []any
}

// household is a retention on a tenant table: the meter role's query for the households with rows
// past their time, and the statement that deletes them in one household's context, whose household
// is its first parameter.
type household struct {
	what      string
	find      string
	statement string
	args      []any
}

// nightly are the expiry sweep's retentions (PRD 03 §5), and the accounts' that items 8, 9 and 15 keep.
// The other rows of PRD 03 §5 are the items' that build their tables: preserved note bodies (item 43)
// and each module's tombstones past its undo window. An export's archive is an object, which the
// sweep removes through privacy.Service.Expire (Config.Exports).
var (
	nightlyAccounts = []account{
		// A web session that ended, revoked or expired, and with it the browser subscriptions it
		// registered.
		{"sessions", "DELETE FROM sessions WHERE revoked_at IS NOT NULL OR expires_at <= now()", nil},
		{"account Idempotency-Keys", "DELETE FROM account_idempotency_keys WHERE created_at < now() - make_interval(secs => $1)",
			[]any{Keys.Seconds()}},
		{"used refresh tokens", "DELETE FROM refresh_tokens WHERE used_at < now() - make_interval(secs => $1)",
			[]any{UsedTokens.Seconds()}},
		// A device's sign-in a month after it was revoked, and its refresh tokens with it. A revoked
		// sign-in's tokens refresh nothing, whatever they are, and its last token was never used, so
		// that no retention of used tokens ever takes it: the sign-in's own end is what ends them.
		{"revoked device sign-ins", "DELETE FROM device_sessions WHERE revoked_at < now() - make_interval(secs => $1)",
			[]any{UsedTokens.Seconds()}},
		{"expired trusts", "DELETE FROM mfa_trusts WHERE expires_at <= now()", nil},
		// A diagnostic bundle 30 days after its member sent it (FR-PS1).
		{"diagnostic bundles", "DELETE FROM diagnostic_bundles WHERE expires_at <= now()", nil},
	}
	nightlyHouseholds = []household{
		{"Idempotency-Keys",
			"SELECT DISTINCT household_id FROM idempotency_keys WHERE created_at < now() - make_interval(secs => $1)",
			"DELETE FROM idempotency_keys WHERE household_id = $1 AND created_at < now() - make_interval(secs => $2)",
			[]any{Keys.Seconds()}},
		{"pushed mutations' answers",
			"SELECT DISTINCT household_id FROM sync_mutations WHERE created_at < now() - make_interval(secs => $1)",
			"DELETE FROM sync_mutations WHERE household_id = $1 AND created_at < now() - make_interval(secs => $2)",
			[]any{Keys.Seconds()}},
		// The count of a household's pushed mutations on a UTC day, which the fair-use ceiling of a day
		// reads only for the day it is (item 17), a week after it.
		{"pushed mutations' days",
			"SELECT DISTINCT household_id FROM sync_usage WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::integer",
			"DELETE FROM sync_usage WHERE household_id = $1 AND day < (now() AT TIME ZONE 'UTC')::date - $2::integer",
			[]any{UsageDays}},
		// A replica's last report, once it has not reported for its time (item 18).
		{"replicas' reports",
			"SELECT DISTINCT household_id FROM sync_replicas WHERE reported_at < now() - make_interval(secs => $1)",
			"DELETE FROM sync_replicas WHERE household_id = $1 AND reported_at < now() - make_interval(secs => $2)",
			[]any{Replicas.Seconds()}},
		// What a notification said, past the seven days its delivery kept it for (FR-HA12): the
		// outcome is kept for as long as the household is.
		{"notification bodies",
			"SELECT DISTINCT household_id FROM notification_deliveries WHERE body_expires_at <= now()",
			`UPDATE notification_deliveries SET title = NULL, body = NULL, body_expires_at = NULL
			 WHERE household_id = $1 AND body_expires_at <= now()`,
			nil},
		// And the arguments a settled notification was rendered from, as long: names and an invitation's
		// message, which would otherwise say what the log no longer does.
		{"notification arguments",
			"SELECT DISTINCT household_id FROM notifications WHERE args_expires_at <= now()",
			`UPDATE notifications SET args = '{}', args_expires_at = NULL
			 WHERE household_id = $1 AND args_expires_at <= now()`,
			nil},
	}
	// The single-use tokens past their time (PRD 03 §5, "Invitation and token expiry").
	hourlyAccounts = []account{
		{"email links", "DELETE FROM email_tokens WHERE expires_at <= now() - make_interval(secs => $1)", []any{Links.Seconds()}},
		{"second steps", "DELETE FROM mfa_challenges WHERE least(ended_at, expires_at) <= now() - make_interval(secs => $1)",
			[]any{Steps.Seconds()}},
		{"provider sign-ins", "DELETE FROM oauth_states WHERE least(used_at, expires_at) <= now() - make_interval(secs => $1)",
			[]any{Steps.Seconds()}},
	}
)

// Sweep is the nightly expiry sweep. A retention that fails is logged and the rest are swept, and
// every failure is returned.
func (s *Sweeper) Sweep(ctx context.Context) error {
	failed := s.accounts(ctx, nightlyAccounts)
	n, err := s.inAccount(ctx, func(tx pgx.Tx) (int64, error) { return ratelimit.Sweep(ctx, tx) })
	failed = errors.Join(failed, s.report(ctx, "sign-in throttles", n, err))
	archives, err := s.cfg.Exports(ctx)
	failed = errors.Join(failed, s.report(ctx, "export archives", int64(archives), err))
	for _, h := range nightlyHouseholds {
		n, err := s.households(ctx, h)
		failed = errors.Join(failed, s.report(ctx, h.what, n, err))
	}
	return failed
}

// Tokens is the hourly expiry of the single-use tokens past their time and of the invitations that
// stopped working a month ago (D-110).
func (s *Sweeper) Tokens(ctx context.Context) error {
	failed := s.accounts(ctx, hourlyAccounts)
	n, err := s.cfg.Invitations(ctx)
	return errors.Join(failed, s.report(ctx, "ended invitations", int64(n), err))
}

// accounts runs each of retentions, reporting each.
func (s *Sweeper) accounts(ctx context.Context, retentions []account) error {
	var failed error
	for _, a := range retentions {
		n, err := s.inAccount(ctx, func(tx pgx.Tx) (int64, error) {
			tag, err := tx.Exec(ctx, a.statement, a.args...)
			return tag.RowsAffected(), err
		})
		failed = errors.Join(failed, s.report(ctx, a.what, n, err))
	}
	return failed
}

// inAccount runs fn in a transaction outside any household, as no one.
func (s *Sweeper) inAccount(ctx context.Context, fn func(pgx.Tx) (int64, error)) (int64, error) {
	var n int64
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var err error
		n, err = fn(tx)
		return err
	})
	return n, err
}

// households runs h in each household the meter role finds with rows past their time, in that
// household's context, and returns how many rows it deleted. A household that fails is logged and
// the rest are swept.
func (s *Sweeper) households(ctx context.Context, h household) (int64, error) {
	rows, err := s.cfg.Meter.Query(ctx, h.find, h.args...)
	if err != nil {
		return 0, err
	}
	found, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	var (
		total  int64
		failed error
	)
	for _, id := range found {
		var n int64
		err := tenant.InWriteTx(tenant.Assume(ctx, s.cfg.Pool, id, uuid.Nil, ""), func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, h.statement, append([]any{id}, h.args...)...)
			n = tag.RowsAffected()
			return err
		})
		if err == nil {
			// Counted once committed: a household whose commit failed deleted nothing.
			total += n
		} else {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "expiry: sweep a household", slog.String("retention", h.what),
				slog.String(logging.KeyHouseholdID, id.String()), slog.Any("error", err))
			failed = errors.Join(failed, err)
		}
		if ctx.Err() != nil {
			return total, ctx.Err()
		}
	}
	return total, failed
}

// report logs what a retention deleted, or how it failed, and returns its error.
func (s *Sweeper) report(ctx context.Context, what string, n int64, err error) error {
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "expiry: a retention failed", slog.String("retention", what), slog.Any("error", err))
		return err
	}
	if n > 0 {
		s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "expiry: deleted what was past its time", slog.String("retention", what), slog.Int64("rows", n))
	}
	return nil
}
