package household

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/text"
)

// How long an invitation works (FR-HH2), and how many accounts a link may bring in: the members'
// fair-use ceiling (PRD 04 §5).
const (
	EmailFor = 14 * 24 * time.Hour
	LinkFor  = 72 * time.Hour
	MaxUses  = 12
)

// The emails, and the web client's route an invitation's link opens (A-24).
const (
	emailInvitation mail.Template = "email.invitation"
	// messageDeclined is the push that tells an inviter their invitation was declined.
	messageDeclined = "notification.invitation_declined"

	routeInvitation = "invitation"
)

// The kinds and states of an invitation, as the contract spells them. An expired invitation is
// stored as pending, and read as expired once its time has passed.
const (
	kindEmail = "email"
	kindLink  = "link"

	statusPending  = "pending"
	statusAccepted = "accepted"
	statusDeclined = "declined"
	statusRevoked  = "revoked"
	statusExpired  = "expired"
)

// invitation is an invitation's row, with its inviter's name.
type invitation struct {
	id          uuid.UUID
	household   uuid.UUID
	kind        string
	email       *string
	role        access.Role
	grants      map[string]access.Level
	message     *string
	invitedBy   uuid.UUID
	inviterName string
	// inviterGone is whether the inviter is no longer a member, read only in the household's context.
	inviterGone bool
	expires     time.Time
	maxUses     int
	uses        int
	status      string
	version     int64
	created     time.Time
}

// invitationColumns are the columns scanInvitation reads, in its order, of invitations i joined to
// users u, the inviter.
const invitationColumns = `i.id, i.household_id, i.kind::text, i.email, i.role::text, i.grants, i.message, i.invited_by,
	u.display_name, NOT EXISTS (SELECT FROM memberships m WHERE m.household_id = i.household_id AND m.user_id = i.invited_by),
	i.expires_at, i.max_uses, i.uses, i.status::text, i.version, i.created_at`

func scanInvitation(row pgx.CollectableRow) (invitation, error) {
	var i invitation
	err := row.Scan(&i.id, &i.household, &i.kind, &i.email, &i.role, &i.grants, &i.message, &i.invitedBy,
		&i.inviterName, &i.inviterGone, &i.expires, &i.maxUses, &i.uses, &i.status, &i.version, &i.created)
	return i, err
}

// state is the invitation's status at now: a pending invitation past its time is expired.
func (i invitation) state(now time.Time) string {
	if i.status == statusPending && !now.Before(i.expires) {
		return statusExpired
	}
	return i.status
}

// actorRef is the contract's ActorRef.
type actorRef struct {
	UserID         *uuid.UUID `json:"user_id"`
	Label          string     `json:"label"`
	IsFormerMember bool       `json:"is_former_member"`
}

// invitationBody is the contract's Invitation.
type invitationBody struct {
	ID        uuid.UUID               `json:"id"`
	Kind      string                  `json:"kind"`
	Email     *string                 `json:"email"`
	Role      access.Role             `json:"role"`
	Grants    map[string]access.Level `json:"grants"`
	URL       *string                 `json:"url"`
	InvitedBy actorRef                `json:"invited_by"`
	CreatedAt time.Time               `json:"created_at"`
	ExpiresAt time.Time               `json:"expires_at"`
	Status    string                  `json:"status"`
	MaxUses   int                     `json:"max_uses"`
	Uses      int                     `json:"uses"`
}

// row is i as its sync row carries it, its status as stored: a client reads an expiry from its time.
func (i invitation) row() invitationBody {
	inviter := i.invitedBy
	return invitationBody{
		ID: i.id, Kind: i.kind, Email: i.email, Role: i.role, Grants: i.grants,
		InvitedBy: actorRef{UserID: &inviter, Label: i.inviterName, IsFormerMember: i.inviterGone},
		CreatedAt: i.created.UTC(), ExpiresAt: i.expires.UTC(), Status: i.status, MaxUses: i.maxUses, Uses: i.uses,
	}
}

// body is i as the household's members read it at now.
func (i invitation) body(now time.Time) invitationBody {
	b := i.row()
	b.Status = i.state(now)
	return b
}

// change is the sync change of i, as it stands after a mutation.
func (i invitation) change() sync.Change {
	return sync.Change{Entity: entityInvitation, ID: i.id, Op: sync.Upsert, Version: i.version, Row: i.row()}
}

// readInvitation reads the invitation id in household's context, locked FOR UPDATE, or the 404
// problem.
func readInvitation(ctx context.Context, tx pgx.Tx, id uuid.UUID) (invitation, error) {
	rows, err := tx.Query(ctx, "SELECT "+invitationColumns+`
		FROM invitations i JOIN users u ON u.id = i.invited_by
		WHERE i.id = $1
		FOR UPDATE OF i`, id)
	if err != nil {
		return invitation{}, err
	}
	i, err := pgx.CollectExactlyOneRow(rows, scanInvitation)
	if errors.Is(err, pgx.ErrNoRows) {
		return invitation{}, problem.NotFound()
	}
	return i, err
}

// inviteRequest is the contract's InvitationCreate.
type inviteRequest struct {
	ID              uuid.UUID               `json:"id"`
	Kind            string                  `json:"kind"`
	Email           *string                 `json:"email"`
	Role            access.Role             `json:"role"`
	Grants          map[string]access.Level `json:"grants"`
	DashboardLayout json.RawMessage         `json:"dashboard_layout"`
	Message         *string                 `json:"message"`
	MaxUses         *int                    `json:"max_uses"`
}

// check refuses what the edge cannot: a child's role, since a child profile is made by an owner and
// never invited (D-17); an email invitation without its address or a link with one; a number of uses
// on an email invitation, which one account accepts; and a message with a control character other
// than a line break or a tab, or a bidirectional control (text.Message). It trims the message, and
// drops one with nothing in it.
func (req *inviteRequest) check() error {
	var errs []problem.FieldError
	if req.Role == access.Child {
		errs = append(errs, problem.FieldError{Field: "/role", Code: problem.FieldInvalid})
	}
	switch {
	case req.Kind == kindEmail && req.Email == nil:
		errs = append(errs, problem.FieldError{Field: "/email", Code: "required"})
	case req.Kind == kindLink && req.Email != nil:
		errs = append(errs, problem.FieldError{Field: "/email", Code: problem.FieldInvalid})
	}
	if req.Kind == kindEmail && req.MaxUses != nil && *req.MaxUses != 1 {
		errs = append(errs, problem.FieldError{Field: "/max_uses", Code: problem.FieldInvalid})
	}
	if req.Message != nil {
		message, ok := text.Message(*req.Message)
		if !ok {
			errs = append(errs, problem.FieldError{Field: "/message", Code: problem.FieldInvalid})
		}
		req.Message = &message
		if message == "" {
			req.Message = nil
		}
	}
	if len(errs) > 0 {
		return problem.Validation(errs...)
	}
	return nil
}

// verified refuses user unless their address is verified: an unverified account cannot extend trust
// beyond itself (FR-ID1), into an invitation or a household it joins.
func verified(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	var ok bool
	if err := tx.QueryRow(ctx, "SELECT email_verified_at IS NOT NULL FROM users WHERE id = $1", user).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return problem.New(http.StatusForbidden, problem.CodeAccountUnverified)
	}
	return nil
}

// proposed are the levels an invitation of role proposes on each of modules: the role's defaults
// (FR-AC3), with the request's levels over them, or Manage everywhere for an owner.
func proposed(role access.Role, requested map[string]access.Level, modules []string) map[string]access.Level {
	grants := Defaults(role, modules)
	if role != access.Owner {
		maps.Copy(grants, requested)
	}
	return grants
}

// letter queues the email of invitation i, whose token is token, in tx, for the notification
// transport to send once tx commits (Nudge): in the language of the account with its address, else
// the household's, with the inviter's and the household's names and the message, and the link that
// carries the token, which waits sealed. It replaces the invitation's email still waiting, whose link
// this one's token ends.
func (s *Service) letter(ctx context.Context, tx pgx.Tx, i invitation, token string) error {
	var household, locale string
	if err := tx.QueryRow(ctx, `
		SELECT h.name, coalesce((SELECT u.locale FROM users u WHERE lower(u.email) = lower($2)), h.locale)
		FROM households h WHERE h.id = $1`, i.household, *i.email).Scan(&household, &locale); err != nil {
		return err
	}
	args := i18n.Args{"inviter": i.inviterName, "household": household, "hasMessage": "no", "message": ""}
	if i.message != nil {
		args["hasMessage"], args["message"] = "yes", *i.message
	}
	return s.Notify.Queue(ctx, tx, notify.Notification{
		Address: *i.email, Locale: locale, Category: notify.Direct, Message: string(emailInvitation), Args: args,
		Email: true, Route: routeInvitation, Secret: token, Replaces: invitationKey(i.id),
	})
}

// invitationKey is the key an invitation's email waits under (notify.Notification.Replaces): sending
// it again replaces it, and the invitation's end withdraws it.
func invitationKey(id uuid.UUID) string { return "invitation:" + id.String() }

// graduationKey is the key the email of a child profile's graduation link waits under: a newer link
// replaces it, and the link spent with its sender's ownership, or with the profile's removal,
// withdraws it.
func graduationKey(child uuid.UUID) string { return "graduation:" + child.String() }

// throttle counts an invitation household sends, and refuses one past its twenty a day (PRD 02 §9).
func (s *Service) throttle(ctx context.Context, household uuid.UUID) error {
	wait, err := s.Throttles.Take(ctx, ratelimit.Count{Limit: ratelimit.InvitationHousehold, Subject: household.String()})
	switch {
	case err != nil:
		return err
	case wait > 0:
		return ratelimit.Refusal(wait)
	}
	return nil
}

// refund takes back the invitation throttle counted for a request that sent nothing, whose mutation
// refused it or failed: the twenty a day count what a household sends, and an owner who tried an
// address with an invitation waiting has sent nothing. A refund that fails is logged; the request's
// own answer stands.
func (s *Service) refund(ctx context.Context, household uuid.UUID) {
	if err := s.Throttles.Refund(context.WithoutCancel(ctx), ratelimit.InvitationHousehold, household.String()); err != nil {
		s.Log.LogAttrs(ctx, slog.LevelError, "invitation throttle not refunded", slog.Any("error", err))
	}
}

// waiting reports whether an email invitation of household other than except, nil for none, waits at
// now for address, whatever its case: an address has one invitation waiting at a time, so that
// neither inviting it again nor sending another again leaves it two. The caller holds the household's
// lock (lockHousehold), so that two requests cannot both find none.
func waiting(ctx context.Context, tx pgx.Tx, household uuid.UUID, address string, except *uuid.UUID, now time.Time) (bool, error) {
	var found bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT FROM invitations
		               WHERE household_id = $1 AND kind = 'email' AND lower(email) = lower($2)
		                 AND status = 'pending' AND expires_at > $3 AND ($4::uuid IS NULL OR id <> $4))`,
		household, address, now, except).Scan(&found)
	return found, err
}

// newToken is a token for an invitation's email or link, and its hash as the row keeps it.
func newToken() (string, []byte) {
	token := session.NewToken()
	return token, session.Hash(token)
}

// invite invites someone into the household (FR-HH2, FR-HA4), an owner's to do once their own
// address is verified: by email, which works 14 days for the one account with the address, or by a
// link, which works 72 hours for as many accounts as it names, one by default. It carries the role and
// the levels accepting it gives, so that what the invitee accepts is what they get. A link is
// answered once and never kept: the response that carries it is not kept by the Idempotency-Key.
func (s *Service) invite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := invitationsOwner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	var req inviteRequest
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := req.check(); err != nil {
		s.fail(w, r, err)
		return
	}
	household, modules := scope.HouseholdID(), Modules
	err := tenant.InTx(ctx, func(tx pgx.Tx) error { return verified(ctx, tx, scope.UserID()) })
	if err == nil {
		err = checkGrants("/grants", req.Grants, req.Role, modules)
	}
	if err == nil {
		err = s.throttle(ctx, household)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	now := s.Now()
	token, hash := newToken()
	var i invitation
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		// Under the household's lock whatever the kind: an invitation is its owner's, and one sent by
		// an owner whose ownership ended meanwhile would outlive its withdrawal (lockAsOwner).
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		if req.Kind == kindEmail {
			other, err := waiting(ctx, tx, household, *req.Email, nil, now)
			if err != nil {
				return mutation.Record{}, err
			}
			member, err := memberAddress(ctx, tx, household, *req.Email)
			if err != nil {
				return mutation.Record{}, err
			}
			if other || member {
				return mutation.Record{}, invalid("/email", problem.FieldInvalid)
			}
		}
		expires, uses := now.Add(EmailFor), 1
		if req.Kind == kindLink {
			expires = now.Add(LinkFor)
			if req.MaxUses != nil {
				uses = *req.MaxUses
			}
		}
		grants, err := json.Marshal(proposed(req.Role, req.Grants, modules))
		if err != nil {
			return mutation.Record{}, err
		}
		var layout any
		if len(req.DashboardLayout) > 0 && string(req.DashboardLayout) != "null" {
			layout = req.DashboardLayout
		}
		rows, err := tx.Query(ctx, `
			WITH i AS (
			  INSERT INTO invitations (id, household_id, kind, email, role, grants, dashboard_layout, message, token_hash,
			                           invited_by, expires_at, max_uses)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			  ON CONFLICT (id) DO NOTHING
			  RETURNING *
			)
			SELECT `+invitationColumns+` FROM i JOIN users u ON u.id = i.invited_by`,
			req.ID, household, req.Kind, req.Email, string(req.Role), grants, layout, req.Message, hash,
			scope.UserID(), expires, uses)
		if err != nil {
			return mutation.Record{}, err
		}
		if i, err = pgx.CollectExactlyOneRow(rows, scanInvitation); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				err = invalid("/id", problem.FieldInvalid)
			}
			return mutation.Record{}, err
		}
		if i.kind == kindEmail {
			if err := s.letter(ctx, tx, i, token); err != nil {
				return mutation.Record{}, err
			}
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionInviteCreate, EntityType: entityInvitation, EntityID: i.id,
				SummaryKey: Name + "." + actionInviteCreate, SummaryArgs: invitationArgs(i),
			},
			Changes: []sync.Change{i.change()},
		}, nil
	})
	if err != nil {
		s.refund(ctx, household)
		s.fail(w, r, err)
		return
	}
	body := i.body(now)
	if i.kind == kindEmail {
		s.Notify.Nudge(ctx, household)
	} else {
		link := notify.Link(s.WebURL, routeInvitation, token)
		body.URL = &link
		idempotency.Unstorable(ctx)
	}
	httpx.WriteJSON(w, http.StatusCreated, body)
}

// invitationsOwner refuses a caller who may not change the household's invitations, which are
// admin's data: 404 to one who cannot see them, holding none on admin, as anything a caller may not
// see is answered, and 403 to one who can and is not an owner.
func invitationsOwner(ctx context.Context) error {
	if err := grant.Require(ctx, Name, access.View); err != nil {
		return err
	}
	return owner(ctx)
}

// memberAddress reports whether address, whatever its case, is the address of one of household's
// members: someone already in, whom an email invitation would ask into a household they are in.
func memberAddress(ctx context.Context, tx pgx.Tx, household uuid.UUID, address string) (bool, error) {
	var member bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT FROM memberships m JOIN users u ON u.id = m.user_id
		               WHERE m.household_id = $1 AND lower(u.email) = lower($2))`, household, address).Scan(&member)
	return member, err
}

// joined reports whether user is a member of household already, whom an invitation into it asks
// into nothing.
func joined(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) (bool, error) {
	var in bool
	err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM memberships WHERE household_id = $1 AND user_id = $2)",
		household, user).Scan(&in)
	return in, err
}

// invitationArgs are the summary arguments of an event about i: its kind, and its address, "" for a
// link.
func invitationArgs(i invitation) map[string]any {
	email := ""
	if i.email != nil {
		email = *i.email
	}
	return map[string]any{"kind": i.kind, "email": email}
}

// listInvitations lists the household's invitations, newest first, to a member with view on admin:
// the module whose data they are.
func (s *Service) listInvitations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := grant.Require(ctx, Name, access.View); err != nil {
		s.fail(w, r, err)
		return
	}
	now := s.Now()
	items := []invitationBody{}
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT "+invitationColumns+`
			FROM invitations i JOIN users u ON u.id = i.invited_by
			WHERE i.household_id = $1
			ORDER BY i.created_at DESC, i.id DESC`, scope.HouseholdID())
		if err != nil {
			return err
		}
		invitations, err := pgx.CollectRows(rows, scanInvitation)
		for _, i := range invitations {
			items = append(items, i.body(now))
		}
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// revokeInvitation withdraws an invitation, an owner's to do: its email or link works no more. One
// already accepted is a membership, which is removed instead.
func (s *Service) revokeInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := invitationsOwner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	id, err := pathUUID(r, "invitation_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		i, err := readInvitation(ctx, tx, id)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case i.status == statusAccepted:
			return mutation.Record{}, problem.NotFound()
		case i.status == statusRevoked:
			return mutation.Record{}, nil
		}
		if i, err = setStatus(ctx, tx, i, statusRevoked); err != nil {
			return mutation.Record{}, err
		}
		// Its email, if it still waits for the mail server, invites no one any more.
		if err := s.Notify.Withdraw(ctx, tx, invitationKey(i.id)); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionInviteRevoke, EntityType: entityInvitation, EntityID: i.id,
				SummaryKey: Name + "." + actionInviteRevoke, SummaryArgs: invitationArgs(i),
			},
			Changes: []sync.Change{i.change()},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// setStatus sets i's status and returns it as it stands.
func setStatus(ctx context.Context, tx pgx.Tx, i invitation, status string) (invitation, error) {
	if err := tx.QueryRow(ctx, "UPDATE invitations SET status = $2 WHERE id = $1 RETURNING version", i.id, status).
		Scan(&i.version); err != nil {
		return invitation{}, err
	}
	i.status = status
	return i, nil
}

// withdraw withdraws the invitations user sent in household that are still waiting at now, and
// returns their changes. An invitation is an owner's grant of access, and lapses with their ownership
// (D-103): what they sent is withdrawn when they are removed, leave or are made a member, so that a
// link they kept cannot bring them back, nor anything they sent bring in someone the owners who stay
// may never have seen. Another owner may send an email invitation again, and it is then theirs.
//
// The graduation links they sent for the household's child profiles are spent with them (D-104), so
// that none works again once they are an owner again: its holder would come into the household with
// the profile's account and everything it made. A link is no row of the household's, and changes
// nothing its replicas hold. A sending reads its sender's role again under the household's lock, which
// this withdrawal's change of role holds, so that none is written after it (graduate); the
// confirmation reads it there too (confirmGraduation).
//
// The emails of both that still wait for the mail server are withdrawn with them.
func (s *Service) withdraw(ctx context.Context, tx pgx.Tx, household, user uuid.UUID, now time.Time) ([]sync.Change, error) {
	rows, err := tx.Query(ctx, `
		UPDATE email_tokens SET used_at = $3
		WHERE purpose = 'graduate' AND used_at IS NULL AND sent_by = $2
		  AND user_id IN (SELECT user_id FROM memberships WHERE household_id = $1 AND role = 'child')
		RETURNING user_id`,
		household, user, now)
	if err != nil {
		return nil, err
	}
	spent, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(spent))
	for _, child := range spent {
		keys = append(keys, graduationKey(child))
	}
	rows, err = tx.Query(ctx, `
		WITH i AS (
		  UPDATE invitations SET status = 'revoked'
		  WHERE household_id = $1 AND invited_by = $2 AND status = 'pending' AND expires_at > $3
		  RETURNING *
		)
		SELECT `+invitationColumns+` FROM i JOIN users u ON u.id = i.invited_by
		ORDER BY i.created_at, i.id`, household, user, now)
	if err != nil {
		return nil, err
	}
	withdrawn, err := pgx.CollectRows(rows, scanInvitation)
	if err != nil {
		return nil, err
	}
	changes := make([]sync.Change, 0, len(withdrawn))
	for _, i := range withdrawn {
		changes = append(changes, i.change())
		if i.kind == kindEmail {
			keys = append(keys, invitationKey(i.id))
		}
	}
	if err := s.Notify.Withdraw(ctx, tx, keys...); err != nil {
		return nil, err
	}
	return changes, nil
}

// resendInvitation sends an email invitation again, an owner's to do once their own address is
// verified, and counted against the household's twenty a day: with a new link, since the old one's
// token is kept only as its hash, which the old link stops matching, and for another 14 days from
// the owner who sent it this time. One declined, withdrawn or expired is open again, as inviting the
// person anew (A-25); one accepted is a membership, and so is one to an address that has joined since,
// by another invitation, which inviting the address anew would refuse; one whose address has another
// invitation waiting is that one's to send, as inviting the address anew would refuse too; a link has
// no address to send to.
func (s *Service) resendInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if err := invitationsOwner(ctx); err != nil {
		s.fail(w, r, err)
		return
	}
	id, err := pathUUID(r, "invitation_id")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	err = tenant.InTx(ctx, func(tx pgx.Tx) error { return verified(ctx, tx, scope.UserID()) })
	if err == nil {
		err = s.throttle(ctx, household)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	now := s.Now()
	token, hash := newToken()
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if _, err := lockAsOwner(ctx, tx); err != nil {
			return mutation.Record{}, err
		}
		old, err := readInvitation(ctx, tx, id)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case old.kind != kindEmail || old.status == statusAccepted:
			return mutation.Record{}, problem.NotFound()
		}
		member, err := memberAddress(ctx, tx, household, *old.email)
		if err != nil {
			return mutation.Record{}, err
		}
		other, err := waiting(ctx, tx, household, *old.email, &old.id, now)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case member || other:
			return mutation.Record{}, problem.NotFound()
		}
		rows, err := tx.Query(ctx, `
			WITH i AS (
			  UPDATE invitations SET token_hash = $2, expires_at = $3, status = 'pending', invited_by = $4 WHERE id = $1
			  RETURNING *
			)
			SELECT `+invitationColumns+` FROM i JOIN users u ON u.id = i.invited_by`,
			id, hash, now.Add(EmailFor), scope.UserID())
		if err != nil {
			return mutation.Record{}, err
		}
		i, err := pgx.CollectExactlyOneRow(rows, scanInvitation)
		if err != nil {
			return mutation.Record{}, err
		}
		if err := s.letter(ctx, tx, i, token); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionInviteResend, EntityType: entityInvitation, EntityID: i.id,
				SummaryKey: Name + "." + actionInviteResend, SummaryArgs: invitationArgs(i),
			},
			Changes: []sync.Change{i.change()},
		}, nil
	})
	if err != nil {
		s.refund(ctx, household)
		s.fail(w, r, err)
		return
	}
	s.Notify.Nudge(ctx, household)
	w.WriteHeader(http.StatusAccepted)
}

// held reads the invitation the request's {token} names, before any household's context: by its
// token, which its email or link carries, or by its id, for its addressee signed in with the verified
// address it was sent to, which is how the invitations addressed to them are listed. user is the
// caller, uuid.Nil for none. An invitation neither names is the 404 problem.
func (s *Service) held(ctx context.Context, r *http.Request, user uuid.UUID) (invitation, error) {
	param := chi.URLParam(r, "token")
	var i invitation
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		where := "i.id = $1"
		var key any
		if id, err := uuid.Parse(param); err == nil {
			key = id
		} else {
			hash := session.Hash(param)
			if _, err := tx.Exec(ctx, "SELECT set_config('app.invitation_token', $1, true)", hex.EncodeToString(hash)); err != nil {
				return err
			}
			where, key = "i.token_hash = $1", hash
		}
		rows, err := tx.Query(ctx, "SELECT "+invitationColumns+" FROM invitations i JOIN users u ON u.id = i.invited_by WHERE "+where, key)
		if err != nil {
			return err
		}
		i, err = pgx.CollectExactlyOneRow(rows, scanInvitation)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return invitation{}, problem.NotFound()
	}
	return i, err
}

// usable refuses an invitation that no longer works at now: 410, token_expired past its time, and
// token_already_used once accepted, declined or withdrawn.
func usable(i invitation, now time.Time) error {
	switch i.state(now) {
	case statusPending:
		return nil
	case statusExpired:
		return problem.New(http.StatusGone, problem.CodeTokenExpired)
	}
	return problem.New(http.StatusGone, problem.CodeTokenAlreadyUsed)
}

// forInvitee is the contract's InvitationForInvitee: exactly what accepting gives, before it is
// accepted (FR-HH3).
type forInvitee struct {
	Token              string        `json:"token"`
	HouseholdName      string        `json:"household_name"`
	HouseholdAvatarURL *string       `json:"household_avatar_url"`
	InvitedBy          string        `json:"invited_by"`
	Role               access.Role   `json:"role"`
	Modules            []moduleLevel `json:"modules"`
	Message            *string       `json:"message"`
	ExpiresAt          time.Time     `json:"expires_at"`
}

// moduleLevel is one module of an invitation and the level it gives.
type moduleLevel struct {
	Module string       `json:"module"`
	Level  access.Level `json:"level"`
}

// errSuspended is forInvitee's answer for an invitation into a suspended household, which nobody is
// shown, as nothing in the household is found (D-115): accepting and declining it answer 404 too.
var errSuspended = errors.New("household: the invitation's household is suspended")

// forInvitee reads what i's invitee is shown, in its household's context, as the caller user: its
// household's name, and the level it gives on each module the household enables. token is how the
// request named it. It returns errSuspended while the household is suspended.
func (s *Service) forInvitee(ctx context.Context, i invitation, token string, user uuid.UUID) (forInvitee, error) {
	out := forInvitee{
		Token: token, InvitedBy: i.inviterName, Role: i.role, Message: i.message, ExpiresAt: i.expires.UTC(),
		Modules: []moduleLevel{},
	}
	err := s.readTx(ctx, i.household, user, func(tx pgx.Tx) error {
		var suspended bool
		if err := tx.QueryRow(ctx, "SELECT name, suspended_at IS NOT NULL FROM households WHERE id = $1", i.household).
			Scan(&out.HouseholdName, &suspended); err != nil {
			return err
		}
		if suspended {
			return errSuspended
		}
		modules := Modules
		enabled, err := enabledModules(ctx, tx, i.household)
		if err != nil {
			return err
		}
		grants := joining(i, modules)
		for _, m := range modules {
			if enabled[m] {
				out.Modules = append(out.Modules, moduleLevel{Module: m, Level: grants[m]})
			}
		}
		return nil
	})
	return out, err
}

// joining are the levels accepting i gives on each of modules: what it proposed, the role's defaults
// on a module it did not name, and Manage everywhere for an owner.
func joining(i invitation, modules []string) map[string]access.Level {
	grants := Defaults(i.role, modules)
	if i.role == access.Owner {
		return grants
	}
	for _, m := range modules {
		if l, ok := i.grants[m]; ok {
			grants[m] = min(l, access.Ceiling(i.role, m))
		}
	}
	return grants
}

// previewInvitation shows an invitation's holder what accepting it gives (FR-HH3, A-24), signed in or
// not: its link opens before the invitee has an account. One into a suspended household is not
// found, as accepting it is not (D-115, D-120).
func (s *Service) previewInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	i, err := s.held(ctx, r, user)
	if err == nil {
		err = usable(i, s.Now())
	}
	var body forInvitee
	if err == nil {
		body, err = s.forInvitee(ctx, i, chi.URLParam(r, "token"), user)
	}
	if errors.Is(err, errSuspended) {
		err = problem.NotFound()
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

// myInvitations lists the email invitations waiting for the caller's verified address, each with its
// id as its token, which they may accept or decline by signed in: those of the households they are not
// in yet, since one they have joined since, by another invitation, asks them into nothing, and none
// into a suspended household, which is not found (D-115).
func (s *Service) myInvitations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	now := s.Now()
	var invitations []invitation
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		// Outside any household's context the policy shows the caller only the email invitations
		// to their verified address, and only their own memberships.
		rows, err := tx.Query(ctx, "SELECT "+invitationColumns+`
			FROM invitations i JOIN users u ON u.id = i.invited_by
			WHERE i.kind = 'email' AND i.status = 'pending' AND i.expires_at > $1
			  AND NOT EXISTS (SELECT FROM memberships m WHERE m.household_id = i.household_id AND m.user_id = $2)
			ORDER BY i.created_at, i.id`, now, user)
		if err != nil {
			return err
		}
		invitations, err = pgx.CollectRows(rows, scanInvitation)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	items := make([]forInvitee, 0, len(invitations))
	for _, i := range invitations {
		item, err := s.forInvitee(ctx, i, i.id.String(), user)
		if errors.Is(err, errSuspended) {
			continue
		}
		if err != nil {
			s.fail(w, r, err)
			return
		}
		items = append(items, item)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// addressed refuses user an email invitation sent to another address, as one that does not exist:
// it binds to its address (FR-HH2).
func addressed(ctx context.Context, tx pgx.Tx, i invitation, user uuid.UUID) error {
	if i.kind != kindEmail {
		return nil
	}
	var match bool
	if err := tx.QueryRow(ctx, "SELECT coalesce(lower(email) = lower($2), false) FROM users WHERE id = $1", user, *i.email).
		Scan(&match); err != nil {
		return err
	}
	if !match {
		return problem.NotFound()
	}
	return nil
}

// acceptInvitation makes the caller a member of the invitation's household with exactly the role and
// the levels it proposed (FR-HH3). Their address must be verified, and an email invitation's must be
// its own. Someone already a member is answered their membership as it is, and the invitation is left
// for its addressee. A household that does not write is joined by nobody, and a suspended one is
// not found (writable, D-120), by its members either (D-115).
func (s *Service) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	now := s.Now()
	held, err := s.held(ctx, r, user)
	if err == nil {
		err = usable(held, now)
	}
	if err == nil {
		err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
			if err := verified(ctx, tx, user); err != nil {
				return err
			}
			return addressed(ctx, tx, held, user)
		})
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household := held.household
	scoped := tenant.Assume(ctx, s.Pool, household, user, held.role)
	var (
		m       membership
		payer   *uuid.UUID
		modules = Modules
		noticed bool
	)
	_, err = mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		var err error
		if payer, err = lockHousehold(ctx, tx, household); err != nil {
			return mutation.Record{}, err
		}
		// A suspended household is not found, by its members either, as on every route of it (D-115),
		// so before a member is answered their membership in it.
		entitled, err := readStatus(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		if !entitled.State().Reads() {
			return mutation.Record{}, problem.NotFound()
		}
		existing, err := readMemberships(ctx, tx, household, &user, false)
		if err != nil {
			return mutation.Record{}, err
		}
		if len(existing) > 0 {
			m = existing[0]
			return mutation.Record{}, nil
		}
		i, err := readInvitation(ctx, tx, held.id)
		if err == nil {
			err = usable(i, now)
		}
		if err == nil {
			// What writable asks, of the state read under the lock above (D-120).
			err = entitled.Writable("")
		}
		if err != nil {
			return mutation.Record{}, err
		}
		members, ceiling, err := memberCeiling(ctx, tx, household)
		if err != nil {
			return mutation.Record{}, err
		}
		grants := joining(i, modules)
		if m, err = insertMembership(ctx, tx, household, user, i.role, grants); err != nil {
			return mutation.Record{}, err
		}
		if noticed, err = s.membersNotice(scoped, tx, household, members, ceiling); err != nil {
			return mutation.Record{}, err
		}
		status := i.status
		if i.uses+1 == i.maxUses {
			status = statusAccepted
		}
		if err := tx.QueryRow(ctx, "UPDATE invitations SET uses = uses + 1, status = $2 WHERE id = $1 RETURNING version, uses",
			i.id, status).Scan(&i.version, &i.uses); err != nil {
			return mutation.Record{}, err
		}
		i.status = status
		if i.kind == kindEmail && status == statusAccepted {
			if err := s.Notify.Withdraw(scoped, tx, invitationKey(i.id)); err != nil {
				return mutation.Record{}, err
			}
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionMemberJoin, EntityType: entityMembership, EntityID: m.id,
				SummaryKey: Name + "." + actionMemberJoin, SummaryArgs: map[string]any{"member": m.name, "role": string(i.role)},
				Changes: joinDiffs(i.role, grants, modules),
			},
			Changes: []sync.Change{m.change(household, payer, modules), i.change()},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if noticed {
		s.Notify.Nudge(ctx, household)
	}
	httpx.WriteJSON(w, http.StatusOK, s.member(ctx, tenant.From(scoped), payer, modules, m))
}

// declineInvitation records that the caller declines an invitation (FR-HH3), and tells the owner who
// sent it (A-25). It closes the invitation, a link's too. An email invitation is declined only from
// an account with its address; one that no longer works is not found, and neither is one into a
// household the caller is in already, which asks them into nothing, as accepting it and sending it
// again treat it: closing it would close a link for those it may still bring in, and tell its
// inviter of a refusal that is not one. It is a write into the household, held to its state as
// accepting is (writable, D-120): refused 402 while the household does not write, and not found while
// it is suspended.
func (s *Service) declineInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	now := s.Now()
	held, err := s.held(ctx, r, user)
	if err == nil && usable(held, now) != nil {
		err = problem.NotFound()
	}
	if err == nil {
		err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error { return addressed(ctx, tx, held, user) })
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	scoped := tenant.Assume(ctx, s.Pool, held.household, user, held.role)
	_, err = mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
		// Under the household's lock, which accepting takes too, so that whether the caller is a
		// member already is read after any acceptance of theirs that was committing meanwhile.
		if _, err := lockHousehold(ctx, tx, held.household); err != nil {
			return mutation.Record{}, err
		}
		i, err := readInvitation(ctx, tx, held.id)
		if err == nil && usable(i, now) != nil {
			err = problem.NotFound()
		}
		if err != nil {
			return mutation.Record{}, err
		}
		in, err := joined(ctx, tx, i.household, user)
		switch {
		case err != nil:
			return mutation.Record{}, err
		case in:
			return mutation.Record{}, problem.NotFound()
		}
		// Closing the invitation, recording it and telling its inviter write into the household, which
		// a household that does not write refuses, and a suspended one is not found for (D-120).
		if err := writable(ctx, tx, i.household); err != nil {
			return mutation.Record{}, err
		}
		if i, err = setStatus(ctx, tx, i, statusDeclined); err != nil {
			return mutation.Record{}, err
		}
		if i.kind == kindEmail {
			if err := s.Notify.Withdraw(scoped, tx, invitationKey(i.id)); err != nil {
				return mutation.Record{}, err
			}
		}
		// The inviter is told by a push, as someone who means them (D-111): the invitations are admin's,
		// which an owner who sent one sees.
		var invitee string
		if err := tx.QueryRow(ctx, "SELECT coalesce(nullif(display_name, ''), email, '') FROM users WHERE id = $1", user).
			Scan(&invitee); err != nil {
			return mutation.Record{}, err
		}
		if err := s.Notify.Queue(scoped, tx, notify.Notification{
			To: i.invitedBy, Category: notify.Direct, Message: messageDeclined, Args: i18n.Args{"invitee": invitee},
			Module: Name, Link: "/households/" + i.household.String() + "/settings/invitations",
		}); err != nil {
			return mutation.Record{}, err
		}
		// The event names the caller as who declined, in the log of a household they are no member of:
		// the one record of that, by which their account's erasure finds the log, is the hook's to keep.
		if err := s.Hooks.named(scoped, tx, i.household, user); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: Name, Action: actionInviteDecline, EntityType: entityInvitation, EntityID: i.id,
				SummaryKey: Name + "." + actionInviteDecline, SummaryArgs: invitationArgs(i),
			},
			Changes: []sync.Change{i.change()},
		}, nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Notify.Nudge(ctx, held.household)
	w.WriteHeader(http.StatusNoContent)
}
