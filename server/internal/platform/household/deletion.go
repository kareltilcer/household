package household

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// DeletionWindow is how long a scheduled deletion, a household's or an account's, may still be
// cancelled (FR-PR4, FR-PR6): 30 days, after which the nightly job erases it for good.
const DeletionWindow = 30 * 24 * time.Hour

// What every member is told when their household's deletion is scheduled, and when it is cancelled
// (FR-PR6): an email, one of the fixed set that arrives whatever a member muted (D-130), and a push
// to the members other than the one who did it.
const (
	emailDeletion                    mail.Template = "email.household_deletion"
	emailDeletionCancelled           mail.Template = "email.household_deletion_cancelled"
	messageDeletion                                = "notification.household_deletion"
	messageDeletionCancelled                       = "notification.household_deletion_cancelled"
	deletionCoalesce                               = "household_deletion"
	deletionDays                                   = int(DeletionWindow / (24 * time.Hour))
	scopeHousehold                                 = "household"
	fieldConfirmName                               = "/confirm_name"
	deletionField                                  = "deletion_scheduled_at"
	causeOwnerless, causeWithAccount               = "ownerless", "account"
)

// Deletion is the contract's DeletionRequest for a household's: its id, when it was asked for and
// when it executes. A household's carries no token: an owner cancels it through the household.
type Deletion struct {
	ID          uuid.UUID `json:"id"`
	Scope       string    `json:"scope"`
	RequestedAt time.Time `json:"requested_at"`
	ExecutesAt  time.Time `json:"executes_at"`
	CancelToken *string   `json:"cancel_token"`
}

// pending is a household's scheduled deletion as its row holds it, with its name, which a request
// to delete it must type.
type pending struct {
	name      string
	id        *uuid.UUID
	requested *time.Time
	scheduled *time.Time
	account   *uuid.UUID
}

// readPending reads household's pending deletion, in tx in its context, under the household's lock.
func readPending(ctx context.Context, tx pgx.Tx, household uuid.UUID) (pending, error) {
	var p pending
	err := tx.QueryRow(ctx, `
		SELECT name, deletion_id, deletion_requested_at, deletion_scheduled_at, deletion_account
		FROM households WHERE id = $1`, household).Scan(&p.name, &p.id, &p.requested, &p.scheduled, &p.account)
	return p, err
}

// body is p as the contract's DeletionRequest, which p must be: a household with one pending.
func (p pending) body() Deletion {
	return Deletion{ID: *p.id, Scope: scopeHousehold, RequestedAt: p.requested.UTC(), ExecutesAt: p.scheduled.UTC()}
}

// tell queues, in tx, what every member of household is told of its deletion scheduled or cancelled:
// an email to each, and a push to each but actor, who did it.
func (s *Service) tell(ctx context.Context, tx pgx.Tx, household, actor uuid.UUID, email mail.Template, message string) error {
	members, err := readMemberships(ctx, tx, household, nil, false)
	if err != nil {
		return err
	}
	ns := make([]notify.Notification, 0, 2*len(members))
	for _, m := range members {
		ns = append(ns, notify.Notification{
			To: m.user, Category: notify.Direct, Message: string(email), Email: true, Args: i18n.Args{"days": deletionDays},
		})
		if m.user != actor {
			ns = append(ns, notify.Notification{
				To: m.user, Category: notify.Direct, Message: message, Link: "/households/" + household.String(),
				Args: i18n.Args{"days": deletionDays}, Coalesce: deletionCoalesce,
			})
		}
	}
	return s.Notify.Queue(ctx, tx, ns...)
}

// schedule schedules household's deletion at now, in tx, the mutation's transaction, under the
// household's lock, and returns its record with the deletion as it stands. account, when set, is the
// account whose own deletion it follows (FR-PR3). A household with one pending already is left as it
// is, and the record is empty: the deletion that was asked for first is the one that executes.
func (s *Service) schedule(ctx context.Context, tx pgx.Tx, household, actor, account uuid.UUID, now time.Time) (mutation.Record, Deletion, error) {
	p, err := readPending(ctx, tx, household)
	if err != nil {
		return mutation.Record{}, Deletion{}, err
	}
	if p.id != nil {
		return mutation.Record{}, p.body(), nil
	}
	var with *uuid.UUID
	if account != uuid.Nil {
		with = &account
	}
	at := now.Add(DeletionWindow)
	h, err := scanSettings(tx.QueryRow(ctx, `
		UPDATE households SET deletion_id = $2, deletion_requested_at = $3, deletion_scheduled_at = $4, deletion_account = $5
		WHERE id = $1
		RETURNING `+settingsColumns, household, idgen.New(), now, at, with))
	if err != nil {
		return mutation.Record{}, Deletion{}, err
	}
	if p, err = readPending(ctx, tx, household); err != nil {
		return mutation.Record{}, Deletion{}, err
	}
	if err := s.tell(ctx, tx, household, actor, emailDeletion, messageDeletion); err != nil {
		return mutation.Record{}, Deletion{}, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: actionDeleteSchedule, EntityType: entitySettings, EntityID: h.id, Level: audit.Warn,
			SummaryKey: Name + "." + actionDeleteSchedule, SummaryArgs: map[string]any{"days": deletionDays},
			Changes: []audit.Change{{Field: deletionField, Old: nil, New: at.UTC()}},
		},
		Changes: []sync.Change{settingsChange(h)},
	}, p.body(), nil
}

// unschedule cancels household's pending deletion p, in tx, the mutation's transaction, under the
// household's lock, and returns its record.
func (s *Service) unschedule(ctx context.Context, tx pgx.Tx, household, actor uuid.UUID, p pending) (mutation.Record, error) {
	h, err := scanSettings(tx.QueryRow(ctx, `
		UPDATE households SET deletion_id = NULL, deletion_requested_at = NULL, deletion_scheduled_at = NULL, deletion_account = NULL
		WHERE id = $1
		RETURNING `+settingsColumns, household))
	if err != nil {
		return mutation.Record{}, err
	}
	if err := s.tell(ctx, tx, household, actor, emailDeletionCancelled, messageDeletionCancelled); err != nil {
		return mutation.Record{}, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: actionDeleteCancel, EntityType: entitySettings, EntityID: h.id, Level: audit.Notice,
			SummaryKey: Name + "." + actionDeleteCancel,
			Changes:    []audit.Change{{Field: deletionField, Old: p.scheduled.UTC(), New: nil}},
		},
		Changes: []sync.Change{settingsChange(h)},
	}, nil
}

// sameName reports whether typed is the household's name as its owner must type it to delete it
// (FR-PR6): the name, whatever its case and the space around it, since the point is that they read
// it, not that they match a capital.
func sameName(typed, name string) bool {
	return strings.EqualFold(strings.TrimSpace(typed), strings.TrimSpace(name))
}

// scheduleDeletion is postDeletion (FR-PR6, FR-HA16): an owner, typing the household's name,
// schedules its deletion for 30 days on. Every member is told at once. Until then the household
// works as it did, so that its members can take what is theirs, and any owner can cancel; the gate
// lets it through in every state but suspended (FR-BI1). A household whose deletion is scheduled
// already is answered with that deletion.
func (s *Service) scheduleDeletion(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var req struct {
		ConfirmName string `json:"confirm_name"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	var d Deletion
	res, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		p, err := readPending(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		if !sameName(req.ConfirmName, p.name) {
			return mutation.Record{}, invalid(fieldConfirmName, problem.FieldInvalid)
		}
		rec, body, err := s.schedule(ctx, tx, household, scope.UserID(), uuid.Nil, s.Now())
		d = body
		return rec, err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if res.EventID != uuid.Nil {
		s.Notify.Nudge(ctx, household)
	}
	httpx.WriteJSON(w, http.StatusAccepted, d)
}

// cancelDeletion is deleteDeletion: any owner cancels the household's pending deletion, and every
// member is told. A household with none pending is not found.
func (s *Service) cancelDeletion(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := owner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		p, err := readPending(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		if p.id == nil {
			return mutation.Record{}, problem.NotFound()
		}
		return s.unschedule(ctx, tx, household, scope.UserID(), p)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Notify.Nudge(ctx, household)
	w.WriteHeader(http.StatusNoContent)
}

// Standing is where a user stands in one of their households, as their account's deletion resolves
// it (FR-PR3).
type Standing struct {
	Household uuid.UUID
	Name      string
	Role      access.Role
	// Members is how many members the household has, the user among them.
	Members int
	// SoleOwner is whether the user is its only owner who will still be there (otherOwners).
	SoleOwner bool
	// Payer is whether the user is its payer of record, and Paying whether its subscription is one
	// that still charges: active, past due or in grace.
	Payer, Paying bool
	// WithAccount is whether its deletion is scheduled to follow the user's account's.
	WithAccount bool
}

// Standings are user's standings in every household they belong to, in the order they joined them,
// each read in its own household's context.
func (s *Service) Standings(ctx context.Context, user uuid.UUID) ([]Standing, error) {
	var out []Standing
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT household_id, role::text FROM memberships WHERE user_id = $1 ORDER BY created_at, id", user)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Standing, error) {
			var st Standing
			err := row.Scan(&st.Household, &st.Role)
			return st, err
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	for i := range out {
		st := &out[i]
		err := tenant.InTx(tenant.Assume(ctx, s.Pool, st.Household, uuid.Nil, ""), func(tx pgx.Tx) error {
			return standing(ctx, tx, user, st)
		})
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// standing fills st, whose household and role are set, with where user stands there, in tx in the
// household's context.
func standing(ctx context.Context, tx pgx.Tx, user uuid.UUID, st *Standing) error {
	var (
		payer, account *uuid.UUID
		billing        string
	)
	if err := tx.QueryRow(ctx, `
		SELECT h.name, h.billing_payer_id, h.billing_state::text, h.deletion_account,
		  (SELECT count(*) FROM memberships m WHERE m.household_id = h.id)
		FROM households h WHERE h.id = $1`, st.Household).Scan(&st.Name, &payer, &billing, &account, &st.Members); err != nil {
		return err
	}
	st.Payer = payer != nil && *payer == user
	st.Paying = billing == "active" || billing == "past_due" || billing == "grace"
	st.WithAccount = account != nil && *account == user
	if st.Role == access.Owner {
		others, err := otherOwners(ctx, tx, st.Household, user)
		if err != nil {
			return err
		}
		st.SoleOwner = others == 0
	}
	return nil
}

// ErrNotSoleOwner is ScheduleWithAccount's answer for a household its user is not, or is no longer,
// the only owner of: it is not theirs alone to delete with their account.
var ErrNotSoleOwner = errors.New("household: not the household's only owner")

// ScheduleWithAccount schedules household's deletion to follow the deletion of user's account
// (FR-PR3): the household they are the only owner of and chose to delete with it, whose every
// member is told now. It is user's own mutation, as ctx's request says it arrived, checked under the
// household's lock: one who is not its only owner by then is answered ErrNotSoleOwner. ctx carries
// the module registry (mutation.Catalog).
func (s *Service) ScheduleWithAccount(ctx context.Context, household, user uuid.UUID) error {
	scoped := tenant.Assume(ctx, s.Pool, household, user, access.Owner)
	res, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockHousehold(ctx, tx, household); err != nil {
			return mutation.Record{}, err
		}
		st := Standing{Household: household}
		err := tx.QueryRow(ctx, "SELECT role::text FROM memberships WHERE household_id = $1 AND user_id = $2", household, user).Scan(&st.Role)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return mutation.Record{}, err
		}
		if err := standing(ctx, tx, user, &st); err != nil {
			return mutation.Record{}, err
		}
		if !st.SoleOwner {
			return mutation.Record{}, ErrNotSoleOwner
		}
		rec, _, err := s.schedule(scoped, tx, household, user, user, s.Now())
		return rec, err
	})
	if err == nil && res.EventID != uuid.Nil {
		s.Notify.Nudge(ctx, household)
	}
	return err
}

// system returns ctx carrying household's scope with no caller, catalog and the system's via: the
// context of a mutation the platform makes of its own accord.
func (s *Service) system(ctx context.Context, catalog *module.Registry, household uuid.UUID) context.Context {
	return mutation.WithVia(mutation.WithCatalog(tenant.Assume(ctx, s.Pool, household, uuid.Nil, ""), catalog), audit.ViaSystem)
}

// CancelWithAccount cancels household's deletion if it follows the deletion of user's account, which
// was cancelled, or which no longer stands: the system's mutation, checked against catalog, since
// whoever cancelled it is signed in to nothing. Every member is told. A household whose deletion is
// its owner's own, or that has none pending, is left as it is.
func (s *Service) CancelWithAccount(ctx context.Context, catalog *module.Registry, household, user uuid.UUID) error {
	scoped := s.system(ctx, catalog, household)
	res, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockHousehold(ctx, tx, household); err != nil {
			return mutation.Record{}, err
		}
		p, err := readPending(ctx, tx, household)
		if err != nil || p.id == nil || p.account == nil || *p.account != user {
			return mutation.Record{}, err
		}
		return s.unschedule(scoped, tx, household, uuid.Nil, p)
	})
	if err == nil && res.EventID != uuid.Nil {
		s.Notify.Nudge(ctx, household)
	}
	return err
}

// Fate is what becomes of a household when an account that was its member is erased.
type Fate struct {
	// Erase says the household goes with the account, for Cause: it has no other member, or its
	// only owner chose to delete it with their account, or nobody is left in it who could own it.
	Erase bool
	Cause string
}

// Depart takes an erased account out of household (FR-PR3, FR-PR4), as the system, checked against
// catalog, and answers what becomes of the household. A household with other members that goes on
// loses the membership, recorded without the name the account no longer has, with the invitations
// the user sent; where they were its only owner, the adult who has been a member longest is made an
// owner first, so that no household is left with nobody to run it (D-131), and where they were its
// payer, billing passes to an owner who stays. A household they were the only member of, one whose
// deletion follows their account's, and one left with no adult but them, is the caller's to erase.
// What the household's own row says of them by name, a restriction they set, loses the name. A user
// who is no member is taken out of nothing, and the household goes on.
func (s *Service) Depart(ctx context.Context, catalog *module.Registry, household, user uuid.UUID) (Fate, error) {
	scoped := s.system(ctx, catalog, household)
	var fate Fate
	// The owner who succeeds them, if one must, is made in a mutation of its own: an event records
	// one thing.
	_, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		payer, err := lockHousehold(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		st := Standing{Household: household}
		err = tx.QueryRow(ctx, "SELECT role::text FROM memberships WHERE household_id = $1 AND user_id = $2", household, user).Scan(&st.Role)
		if errors.Is(err, pgx.ErrNoRows) {
			return mutation.Record{}, nil
		}
		if err != nil {
			return mutation.Record{}, err
		}
		if err := standing(ctx, tx, user, &st); err != nil {
			return mutation.Record{}, err
		}
		switch {
		case st.Members == 1, st.SoleOwner && st.WithAccount:
			fate = Fate{Erase: true, Cause: causeWithAccount}
			return mutation.Record{}, nil
		case !st.SoleOwner:
			return mutation.Record{}, nil
		}
		// The adult who joined first and is staying.
		var successor uuid.UUID
		err = tx.QueryRow(ctx, `
			SELECT m.user_id FROM memberships m
			WHERE m.household_id = $1 AND m.role = 'member' AND m.user_id <> $2
			  AND NOT EXISTS (SELECT FROM account_deletions d WHERE d.user_id = m.user_id)
			ORDER BY m.created_at, m.id LIMIT 1`, household, user).Scan(&successor)
		if errors.Is(err, pgx.ErrNoRows) {
			fate = Fate{Erase: true, Cause: causeOwnerless}
			return mutation.Record{}, nil
		}
		if err != nil {
			return mutation.Record{}, err
		}
		old, err := readMembership(ctx, tx, household, successor, true)
		if err != nil {
			return mutation.Record{}, err
		}
		grants := Defaults(access.Owner, Modules)
		if err := writeGrants(ctx, tx, household, successor, grants); err != nil {
			return mutation.Record{}, err
		}
		m, err := touch(ctx, tx, old, access.Owner, grants)
		if err != nil {
			return mutation.Record{}, err
		}
		if err := s.accessNotice(scoped, tx, household, successor, CauseGrant); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionMemberSucceed, EntityType: entityMembership, EntityID: m.id, Level: audit.Notice,
				SummaryKey: Name + "." + actionMemberSucceed, SummaryArgs: map[string]any{"member": m.name},
				Changes: memberDiffs(old.role, access.Owner, old.grants, grants, Modules),
			},
			Changes: []sync.Change{m.change(household, payer, Modules)},
		}, nil
	})
	if err != nil || fate.Erase {
		return fate, err
	}
	defer s.Notify.Nudge(ctx, household)
	_, err = mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		payer, err := lockHousehold(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		var changes []sync.Change
		// The name a restriction they set shows goes, whether or not they are still a member: the
		// banner names a former member from then on.
		tag, err := tx.Exec(ctx, `
			UPDATE households SET restricted_by_label = '' WHERE id = $1 AND restricted_by = $2 AND restricted_by_label <> ''`,
			household, user)
		if err != nil {
			return mutation.Record{}, err
		}
		touched := tag.RowsAffected() > 0
		members, err := readMemberships(ctx, tx, household, &user, true)
		if err != nil {
			return mutation.Record{}, err
		}
		if len(members) == 1 && payer != nil && *payer == user {
			// Billing passes to the owner who has been one longest, the successor among them.
			if _, err := tx.Exec(ctx, `
				UPDATE households SET billing_payer_id = (
				  SELECT m.user_id FROM memberships m
				  WHERE m.household_id = $1 AND m.role = 'owner' AND m.user_id <> $2
				  ORDER BY m.created_at, m.id LIMIT 1)
				WHERE id = $1`, household, user); err != nil {
				return mutation.Record{}, err
			}
			touched = true
		}
		if touched {
			h, err := readSettings(ctx, tx, household)
			if err != nil {
				return mutation.Record{}, err
			}
			changes = append(changes, settingsChange(h))
		}
		event := audit.Event{
			Module: Name, Action: actionMemberErase, EntityType: entitySettings, EntityID: household, Level: audit.Notice,
			SummaryKey: Name + "." + actionMemberErase,
		}
		if len(members) == 1 {
			m := members[0]
			if _, err := tx.Exec(ctx, "DELETE FROM memberships WHERE id = $1", m.id); err != nil {
				return mutation.Record{}, err
			}
			withdrawn, err := s.withdraw(scoped, tx, household, user, s.Now())
			if err != nil {
				return mutation.Record{}, err
			}
			if err := s.Hooks.lost(scoped, tx, Loss{Household: household, Cause: CauseErased, Members: map[uuid.UUID][]string{user: nil}}); err != nil {
				return mutation.Record{}, err
			}
			event.EntityType, event.EntityID = entityMembership, m.id
			event.Changes = []audit.Change{{Field: "role", Old: m.role, New: nil}}
			changes = append(append(changes, m.gone()), withdrawn...)
		}
		if len(changes) == 0 {
			return mutation.Record{}, nil
		}
		return mutation.Record{Event: event, Changes: changes}, nil
	})
	return fate, err
}

// export is admin's ExportSource (D-6, FR-PR2): the household's settings, its members with their
// roles and grants, its modules and its invitations, as the API answers them, for an owner's export
// of the household; the household's name and the requester's own membership for a member's export
// of what is theirs; and nothing for one who has left, whose membership is gone.
func export(ctx context.Context, tx pgx.Tx, e module.Export, a module.Archive) error {
	if e.Scope == module.ExportDeparted {
		return nil
	}
	h, err := readSettings(ctx, tx, e.Household)
	if err != nil {
		return err
	}
	var only *uuid.UUID
	if e.Scope == module.ExportPersonal {
		only = &e.Requester
	}
	members, err := readMemberships(ctx, tx, e.Household, only, false)
	if err != nil {
		return err
	}
	bodies := make([]memberBody, 0, len(members))
	for _, m := range members {
		b := m.row(e.Household, h.payer, Modules)
		b.Email = m.email
		bodies = append(bodies, b)
	}
	if e.Scope == module.ExportPersonal {
		return a.JSON(map[string]any{"household": map[string]any{"id": h.id, "name": h.name}, "members": bodies})
	}
	rows, err := tx.Query(ctx, "SELECT id, module, enabled, version FROM module_enablement WHERE household_id = $1 ORDER BY module", e.Household)
	if err != nil {
		return err
	}
	modules, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (enablementRow, error) {
		var m enablementRow
		err := row.Scan(&m.ID, &m.Module, &m.Enabled, &m.Version)
		return m, err
	})
	if err != nil {
		return err
	}
	rows, err = tx.Query(ctx, "SELECT "+invitationColumns+` FROM invitations i JOIN users u ON u.id = i.invited_by
		WHERE i.household_id = $1 ORDER BY i.created_at, i.id`, e.Household)
	if err != nil {
		return err
	}
	invitations, err := pgx.CollectRows(rows, scanInvitation)
	if err != nil {
		return err
	}
	invited := make([]invitationBody, 0, len(invitations))
	for _, i := range invitations {
		invited = append(invited, i.row())
	}
	return a.JSON(map[string]any{"household": h.row(), "members": bodies, "modules": modules, "invitations": invited})
}

// erase is admin's EraseSource (D-6): nothing of its own. The household's settings, memberships,
// grants, modules and invitations leave with the household's row, and a member's membership is
// ended through the spine (Depart), not here.
func erase(context.Context, pgx.Tx, module.Erasure) error { return nil }
