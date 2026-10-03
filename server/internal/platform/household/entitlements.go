package household

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// emailRetention is each of the three warnings a lapsed household's owners are emailed before its
// data is deleted (D-32, D-119): billing is one of the fixed email set (FR-NT1).
const emailRetention mail.Template = "email.retention_warning"

// readStatus reads household's entitlement, in tx in its context.
func readStatus(ctx context.Context, tx pgx.Tx, household uuid.UUID) (entitlement.Status, error) {
	var e entitlement.Row
	if err := tx.QueryRow(ctx, entitlement.Query, household).Scan(e.Dest()...); err != nil {
		return entitlement.Status{}, err
	}
	return e.Status()
}

// writable refuses, in tx in household's context, a write into a household from outside its routes,
// which the tenant middleware's gate never sees, when the household's state does not permit it
// (D-120): declining an invitation, an account route, and confirming a graduation, a public one;
// accepting one asks the same of the state it reads first, to find a suspension before it answers a
// member their membership. It asks what the gate asks (entitlement.Status.Writable): a suspended
// household is not found, as it is on every route (D-115); one that does not write is refused 402
// naming its state, and the caller, who holds no role there or a child's, is told to ask an owner.
func writable(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	status, err := readStatus(ctx, tx, household)
	if err != nil {
		return err
	}
	return status.Writable("")
}

// restrictRequest is postHouseholdRestriction's body, which it may leave out.
type restrictRequest struct {
	Reason *string `json:"reason"`
}

// restrict restricts the household's processing (FR-BI7, D-87, GDPR Art. 18), any owner's to do:
// everything stays readable, downloadable and exportable, and nothing can be written until an owner
// lifts it. The subscription is untouched. The owner and the time are kept for the banner every
// member sees, under the name the owner has now, and the reason they give, if any, is shown there
// and in the activity log. A household restricted already is answered as it stands. The gate lets
// it through in every state but suspended (FR-BI1).
func (s *Service) restrict(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var req restrictRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		s.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	var reason *string
	if req.Reason != nil {
		kept, ok := text.Message(*req.Reason)
		if !ok {
			s.fail(w, r, invalid("/reason", problem.FieldInvalid))
			return
		}
		if kept != "" {
			reason = &kept
		}
	}
	var (
		status entitlement.Status
		st     storage.Standing
	)
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		var err error
		if st, err = s.standing(ctx, tx, scope.HouseholdID()); err != nil {
			return mutation.Record{}, err
		}
		if status, err = readStatus(ctx, tx, scope.HouseholdID()); err != nil || status.Restriction != nil {
			return mutation.Record{}, err
		}
		h, err := scanSettings(tx.QueryRow(ctx, `
			UPDATE households SET restricted_at = now(), restricted_by = $2,
			  restricted_by_label = (SELECT display_name FROM users WHERE id = $2), restriction_reason = $3
			WHERE id = $1
			RETURNING `+settingsColumns, scope.HouseholdID(), scope.UserID(), reason))
		if err != nil {
			return mutation.Record{}, err
		}
		if status, err = readStatus(ctx, tx, h.id); err != nil {
			return mutation.Record{}, err
		}
		diffs := []audit.Change{{Field: "restricted", Old: false, New: true}}
		if reason != nil {
			diffs = append(diffs, audit.Change{Field: "reason", Old: nil, New: *reason})
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionRestrict, EntityType: entitySettings, EntityID: h.id,
				SummaryKey: Name + "." + actionRestrict, Changes: diffs,
			},
			Changes: []sync.Change{settingsChange(h)},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, withStorage(status.Summary(s.Now()), st))
}

// unrestrict lifts the household's restriction, any owner's to do, at once (FR-BI7): the household
// is in whatever state its subscription puts it in, which may not write either, if it lapsed while
// restricted. A household that is not restricted is answered as it stands. The gate lets it through
// in every state but suspended: a restriction nobody can lift is a household nobody can use.
func (s *Service) unrestrict(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var (
		status entitlement.Status
		st     storage.Standing
	)
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		var err error
		if st, err = s.standing(ctx, tx, scope.HouseholdID()); err != nil {
			return mutation.Record{}, err
		}
		if status, err = readStatus(ctx, tx, scope.HouseholdID()); err != nil || status.Restriction == nil {
			return mutation.Record{}, err
		}
		h, err := scanSettings(tx.QueryRow(ctx, `
			UPDATE households SET restricted_at = NULL, restricted_by = NULL, restricted_by_label = NULL, restriction_reason = NULL
			WHERE id = $1
			RETURNING `+settingsColumns, scope.HouseholdID()))
		if err != nil {
			return mutation.Record{}, err
		}
		if status, err = readStatus(ctx, tx, h.id); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionUnrestrict, EntityType: entitySettings, EntityID: h.id,
				SummaryKey: Name + "." + actionUnrestrict,
				Changes:    []audit.Change{{Field: "restricted", Old: true, New: false}},
			},
			Changes: []sync.Change{settingsChange(h)},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, withStorage(status.Summary(s.Now()), st))
}

// Transition moves every household whose subscription's clock has run out along it, as the meter
// role finds them (PRD 03 §5's hourly trial and dunning transitions, PRD 04 §3): a trial that ended
// unpaid and dunning that was exhausted enter grace, and grace that ended enters read_only, whose
// 12-month countdown starts then (entitlement.Status.Advance); and it emails the owners of a lapsed
// household each of the three warnings before its data is deleted, as each falls due (D-119). Each
// is a mutation of the system's, recording the change on the household's row. The deletion itself is
// item 20's, of a household whose retained_until has passed with its three warnings sent.
//
// catalog is the module registry the mutations are checked against. It returns how many households it
// changed; a household that fails is logged and the rest go on, and every failure is returned. A
// move's audit change is the subscription's (billing_state): the resolved state of a household
// restricted or suspended beneath it is the same before and after.
func (s *Service) Transition(ctx context.Context, meter Querier, catalog *module.Registry) (int, error) {
	now := s.Now()
	rows, err := meter.Query(ctx, `
		SELECT id FROM households
		WHERE billing_state <> 'active' AND (
		  (billing_state = 'trialing' AND trial_ends_at <= $1)
		  OR (billing_state = 'past_due' AND dunning_ends_at <= $1)
		  OR (billing_state = 'grace' AND grace_ends_at <= $1)
		  OR (billing_state IN ('read_only', 'canceled') AND retention_warnings < $2
		      AND retained_until - make_interval(secs => ($3::float8[])[retention_warnings + 1]) <= $1))
		ORDER BY id`, now, len(entitlement.Warnings), warningSeconds())
	if err != nil {
		return 0, err
	}
	households, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	var (
		changed int
		failed  error
	)
	for _, household := range households {
		did, err := s.transition(ctx, household, catalog, now)
		if did {
			changed++
		}
		if err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "household: entitlement transition", slog.String("household_id", household.String()),
				slog.Any("error", err))
			failed = errors.Join(failed, err)
		}
		if ctx.Err() != nil {
			return changed, ctx.Err()
		}
	}
	return changed, failed
}

// warningSeconds are entitlement.Warnings in seconds, the first warning's first.
func warningSeconds() []float64 {
	out := make([]float64, len(entitlement.Warnings))
	for i, d := range entitlement.Warnings {
		out[i] = d.Seconds()
	}
	return out
}

// transition advances household's subscription to now, then sends the warning due, each its own
// mutation, reading the household again under its lock: an owner's subscription that resumed
// meanwhile (item 19) leaves nothing to do. A warning sent late moves the deletion out to give the
// notice it promises (entitlement.Status.Warn). It reports whether it changed anything.
func (s *Service) transition(ctx context.Context, household uuid.UUID, catalog *module.Registry, now time.Time) (bool, error) {
	scoped := mutation.WithVia(mutation.WithCatalog(tenant.Assume(ctx, s.Pool, household, uuid.Nil, ""), catalog), audit.ViaSystem)
	advanced, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockHousehold(ctx, tx, household); err != nil {
			return mutation.Record{}, err
		}
		old, err := readStatus(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		next, changed := old.Advance(now)
		if !changed {
			return mutation.Record{}, nil
		}
		h, err := scanSettings(tx.QueryRow(ctx, `
			UPDATE households SET billing_state = $2, grace_ends_at = $3, lapsed_at = $4, retained_until = $5, retention_warnings = $6
			WHERE id = $1
			RETURNING `+settingsColumns,
			household, string(next.Billing), next.GraceEndsAt, next.LapsedAt, next.RetainedUntil, next.RetentionWarnings))
		if err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionEntitlement, EntityType: entitySettings, EntityID: h.id,
				SummaryKey:  Name + "." + actionEntitlement,
				SummaryArgs: map[string]any{"state": string(next.Billing), "from": string(old.Billing)},
				Changes:     []audit.Change{{Field: "billing_state", Old: string(old.Billing), New: string(next.Billing)}},
			},
			Changes: []sync.Change{settingsChange(h)},
		}, nil
	})
	if err != nil {
		return false, err
	}
	warned, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockHousehold(ctx, tx, household); err != nil {
			return mutation.Record{}, err
		}
		status, err := readStatus(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		warned, due := status.Warn(now)
		if !due {
			return mutation.Record{}, nil
		}
		h, err := scanSettings(tx.QueryRow(ctx, `
			UPDATE households SET retention_warnings = $2, retained_until = $3 WHERE id = $1
			RETURNING `+settingsColumns, household, warned.RetentionWarnings, warned.RetainedUntil))
		if err != nil {
			return mutation.Record{}, err
		}
		days := warned.DaysLeft(now)
		owners, err := tenant.Owners(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		// One warning, however many fell due while the job did not run: the latest says how long is
		// left, which is what an owner acts on.
		ns := make([]notify.Notification, 0, len(owners))
		for _, o := range owners {
			ns = append(ns, notify.Notification{
				To: o, Category: notify.Direct, Message: string(emailRetention), Email: true,
				Args: i18n.Args{"days": days, "state": string(status.Billing)},
			})
		}
		if err := s.Notify.Queue(scoped, tx, ns...); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionRetentionWarning, EntityType: entitySettings, EntityID: h.id,
				SummaryKey: Name + "." + actionRetentionWarning, SummaryArgs: map[string]any{"days": days},
			},
			Changes: []sync.Change{settingsChange(h)},
		}, nil
	})
	if err != nil {
		return advanced.EventID != uuid.Nil, err
	}
	if warned.EventID != uuid.Nil {
		s.Notify.Nudge(ctx, household)
	}
	return advanced.EventID != uuid.Nil || warned.EventID != uuid.Nil, nil
}

// ownedCeiling refuses user, in tx, the transaction that creates a household of theirs, when they own
// fairuse.Households already (PRD 04 §5, D-116), and otherwise returns how many they own. The
// households a user creates are serialised on a lock of theirs, which the transaction holds until it
// commits, so that two at once count each other; their memberships are read outside the new
// household's context, where row-level security admits a user's own (tenant.Outside). Being made an
// owner of a household someone else made is that household's owners' decision, and is not counted
// against them here.
func ownedCeiling(ctx context.Context, tx pgx.Tx, user uuid.UUID) (int64, error) {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1, hashtext($2))", db.OwnerLock, user.String()); err != nil {
		return 0, err
	}
	var owned int64
	if err := tenant.Outside(ctx, tx, func() error {
		return tx.QueryRow(ctx, "SELECT count(*) FROM memberships WHERE user_id = $1 AND role = 'owner'", user).Scan(&owned)
	}); err != nil {
		return 0, err
	}
	if owned >= fairuse.Households {
		return owned, fairuse.HouseholdLimit()
	}
	return owned, nil
}

// messageOwnedNotice is the push that tells a user the household they made brings them to 80 % of
// the households they may own.
const messageOwnedNotice = "notification.fair_use_households"

// ownedNotice queues, in tx in household's context, the push that tells user that household, which
// they have just made after owning before, brings them to 80 % of the households they may own (D-116),
// and reports whether it did, for the caller to nudge the transport once tx commits: once, at the
// creation that crosses it.
func (s *Service) ownedNotice(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, before int64) (bool, error) {
	if !fairuse.Crossed(before, before+1, fairuse.Households) {
		return false, nil
	}
	return true, s.Notify.Queue(ctx, tx, notify.Notification{
		To: user, Category: notify.Direct, Message: messageOwnedNotice,
		Args: i18n.Args{"held": before + 1, "ceiling": int64(fairuse.Households)},
		Link: "/households/" + household.String(),
	})
}

// memberCeiling refuses a new member of household, in tx under the household's lock (lockHousehold),
// when it has fairuse.Members already (PRD 04 §5, D-116), child profiles among them, and otherwise
// returns how many it has.
func memberCeiling(ctx context.Context, tx pgx.Tx, household uuid.UUID) (int64, error) {
	var members int64
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM memberships WHERE household_id = $1", household).Scan(&members); err != nil {
		return 0, err
	}
	if members >= fairuse.Members {
		return members, fairuse.Refusal(fairuse.ResourceMembers, fairuse.Members, "")
	}
	return members, nil
}

// membersNotice queues, in tx, the push that tells household's owners it crossed 80 % of its
// members' ceiling, when going from before members to one more crossed it, and reports whether it
// did, for the caller to nudge the transport once tx commits.
func (s *Service) membersNotice(ctx context.Context, tx pgx.Tx, household uuid.UUID, before int64) (bool, error) {
	if !fairuse.Crossed(before, before+1, fairuse.Members) {
		return false, nil
	}
	return true, fairuse.Notice(ctx, tx, s.Notify, household, fairuse.ResourceMembers, "", before+1, fairuse.Members)
}
