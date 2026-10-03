package billing

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	households "github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// OfferFor is how long the payer's offer of billing stands before it lapses, as an invitation does.
const OfferFor = 14 * 24 * time.Hour

// takeoverRoute is the web client's take-over screen of household (A-29), which the offer's email
// opens.
func takeoverRoute(household uuid.UUID) string {
	return "households/" + household.String() + "/billing/takeover"
}

// offerRequest is postBillingTransfer's body.
type offerRequest struct {
	UserID uuid.UUID `json:"user_id"`
}

// offer is postBillingTransfer: the payer offers billing to another of the household's owners
// (FR-BI6, FR-HH6), who is emailed. Nothing about the subscription changes, and the payer goes on
// paying, until the other owner accepts; an offer replaces the one before it, and lapses in 14 days.
// Billing moves only between owners, so anyone else named is refused 422.
func (s *Service) offer(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req offerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.fail(w, r, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household := scope.HouseholdID()
	err = tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		if _, _, err := payer(ctx, tx); err != nil {
			return err
		}
		to, err := isOwner(ctx, tx, household, req.UserID)
		if err != nil {
			return err
		}
		if !to || req.UserID == scope.UserID() {
			return problem.Validation(problem.FieldError{Field: "/user_id", Code: problem.FieldInvalid})
		}
		now := s.Now()
		if _, err := tx.Exec(ctx, `
			INSERT INTO billing_transfers (household_id, offered_by, offered_to, offered_at, expires_at) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (household_id) DO UPDATE SET offered_by = excluded.offered_by, offered_to = excluded.offered_to,
			  offered_at = excluded.offered_at, expires_at = excluded.expires_at`,
			household, scope.UserID(), req.UserID, now, now.Add(OfferFor)); err != nil {
			return err
		}
		var name string
		if err := tx.QueryRow(ctx, "SELECT display_name FROM users WHERE id = $1", scope.UserID()).Scan(&name); err != nil {
			return err
		}
		// The latest offer's email alone: one to someone the payer offered it to before is dropped.
		return s.Notify.Queue(ctx, tx, notify.Notification{
			To: req.UserID, Category: notify.Direct, Message: emailBillingOffer, Email: true,
			Args: i18n.Args{"member": name}, Route: takeoverRoute(household), Replaces: "billing:offer",
		})
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Notify.Nudge(ctx, household)
	w.WriteHeader(http.StatusAccepted)
}

// withdraw is deleteBillingTransfer: the payer takes their offer back, or the owner it was made to
// declines it, which the payer is told. Either way the subscription carries on as it is. With no
// offer open there is nothing to do, and it answers the same.
func (s *Service) withdraw(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household, user := scope.HouseholdID(), scope.UserID()
	declined := false
	err = tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, household); err != nil {
			return err
		}
		offer, ok, err := readOffer(ctx, tx, household, s.Now())
		if err != nil {
			return err
		}
		if !ok {
			// One that lapsed is gone for whoever asks.
			_, err := tx.Exec(ctx, "DELETE FROM billing_transfers WHERE household_id = $1 AND (offered_by = $2 OR offered_to = $2)", household, user)
			return err
		}
		if offer.by != user && offer.to != user {
			return forbidden()
		}
		if _, err := tx.Exec(ctx, "DELETE FROM billing_transfers WHERE household_id = $1", household); err != nil {
			return err
		}
		if err := s.Notify.Withdraw(ctx, tx, "billing:offer"); err != nil {
			return err
		}
		if offer.to != user {
			return nil
		}
		declined = true
		return s.Notify.Queue(ctx, tx, notify.Notification{
			To: offer.by, Category: notify.Direct, Message: messageDeclined,
			Args: i18n.Args{"member": offer.toLabel}, Link: "/" + billingRoute(household),
		})
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if declined {
		s.Notify.Nudge(ctx, household)
	}
	w.WriteHeader(http.StatusNoContent)
}

// acceptDoc is postBillingTransferAccept's answer: the subscription as it stands, and what the
// caller confirms with the processor before billing moves, null when nothing is left to confirm.
type acceptDoc struct {
	Subscription subscriptionDoc `json:"subscription"`
	Confirmation *intentDoc      `json:"confirmation"`
}

// accept is postBillingTransferAccept: the owner the payer offered billing to takes it over (FR-BI6).
// Where the household has a subscription, they are answered the secret their card is confirmed with
// at the processor, and billing moves once it is (takeOver): until then the payer goes on paying,
// and a card that is not accepted changes nothing. Where it has none, there is no card to supply
// yet, and they are the payer at once. Only an owner whose address is verified takes billing over,
// as only one subscribes.
func (s *Service) accept(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := owner(ctx)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	household, user := scope.HouseholdID(), scope.UserID()
	var (
		f   facts
		cur subscription
		has bool
	)
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		offer, ok, err := readOffer(ctx, tx, household, s.Now())
		if err != nil {
			return err
		}
		if !ok || offer.to != user {
			return problem.NotFound()
		}
		if ok, err := verified(ctx, tx, user); err != nil || !ok {
			if err == nil {
				err = problem.New(http.StatusForbidden, problem.CodeAccountUnverified)
			}
			return err
		}
		if f, err = readFacts(ctx, tx, household); err != nil {
			return err
		}
		subs, err := readSubscriptions(ctx, tx, household)
		cur, has = standing(subs, standingCurrent)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var confirmation *intentDoc
	if !has {
		if err := s.acceptAlone(r, household, user); err != nil {
			s.fail(w, r, err)
			return
		}
	} else {
		p, err := s.processor()
		if err != nil {
			s.fail(w, r, err)
			return
		}
		customer, err := s.customer(ctx, p, user, cur.currency, f.country)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		c, err := p.Setup(ctx, NewSetup{Customer: customer, Household: household, User: user, Purpose: PurposeTakeover})
		if err != nil {
			s.fail(w, r, err)
			return
		}
		doc := s.intent(c)
		confirmation = &doc
	}
	var out acceptDoc
	out.Confirmation = confirmation
	err = tenant.InTx(ctx, func(tx pgx.Tx) error {
		status, err := readStatus(ctx, tx, household)
		if err != nil {
			return err
		}
		out.Subscription, err = s.document(ctx, tx, household, user, status)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// acceptAlone makes user the payer of household, which has no subscription to take over, while the
// offer made them still stands: read again under the household's lock, in the mutation that moves
// the payer.
func (s *Service) acceptAlone(r *http.Request, household, user uuid.UUID) error {
	ctx := r.Context()
	gone := false
	err := s.bill(ctx, household, func(tx pgx.Tx, b households.Billing) (households.Billing, error) {
		offer, ok, err := readOffer(ctx, tx, household, s.Now())
		if err != nil {
			return b, err
		}
		if !ok || offer.to != user {
			gone = true
			return b, nil
		}
		b.Payer = &user
		return b, nil
	})
	if err == nil && gone {
		return problem.NotFound()
	}
	return err
}
