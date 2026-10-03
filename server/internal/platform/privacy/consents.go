package privacy

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// consentsJSON is the contract's Consents. updated_at is left out for an account that never set
// them, which consented to nothing.
type consentsJSON struct {
	Analytics      bool       `json:"analytics"`
	MarketingEmail bool       `json:"marketing_email"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
}

// readConsents reads user's consents in tx: neither, for an account with no row.
func readConsents(ctx context.Context, tx pgx.Tx, user uuid.UUID) (consentsJSON, error) {
	var c consentsJSON
	err := tx.QueryRow(ctx, "SELECT analytics, marketing_email, updated_at FROM consents WHERE user_id = $1", user).
		Scan(&c.Analytics, &c.MarketingEmail, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return consentsJSON{}, nil
	}
	if c.UpdatedAt != nil {
		at := c.UpdatedAt.UTC()
		c.UpdatedAt = &at
	}
	return c, err
}

// getConsents is getMeConsents (FR-PR9): what the account consented to, neither until it says so.
func (s *Service) getConsents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var c consentsJSON
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		var err error
		c, err = readConsents(ctx, tx, user)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// putConsents is putMeConsents (FR-PR9): the account's consents become what the body says, one it
// leaves out withdrawn, since consent is given by saying so and never by default. A child profile
// consents to nothing and is refused 403: it is excluded from analytics entirely, and is sent no
// marketing (PRD 05 §7).
func (s *Service) putConsents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		Analytics      bool `json:"analytics"`
		MarketingEmail bool `json:"marketing_email"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	var c consentsJSON
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		child, err := identity.IsChild(ctx, tx, user)
		if err != nil {
			return err
		}
		if child {
			return problem.New(http.StatusForbidden, problem.CodeForbidden)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO consents (user_id, analytics, marketing_email, updated_at) VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id) DO UPDATE SET analytics = excluded.analytics, marketing_email = excluded.marketing_email,
			  updated_at = excluded.updated_at`, user, req.Analytics, req.MarketingEmail, s.cfg.Now()); err != nil {
			return err
		}
		if c, err = readConsents(ctx, tx, user); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// maxPayload caps a diagnostic bundle's payload as it is stored: sync metadata, a few kilobytes of
// it, never a household's content (PRD 10 §6).
const maxPayload = 256 << 10

// sendDiagnostics is postMeDiagnostics (FR-PS1, D-20): the bundle the member assembled, saw in full
// and chose to send is kept for 30 days, for platform staff to read (item 21), and is the only thing
// of a household that ever reaches them. The server keeps what it is sent and reads none of it: what
// goes in, sync metadata and no field values (PRD 10 §6), and what the member took out, are the
// client's, which shows it before it is sent. A bundle about a household names one its sender
// belongs to. The same bundle sent again, by its id, is kept once.
func (s *Service) sendDiagnostics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	var req struct {
		ID              *uuid.UUID     `json:"id"`
		Screen          string         `json:"screen"`
		HouseholdID     *uuid.UUID     `json:"household_id"`
		TicketReference *string        `json:"ticket_reference"`
		Payload         map[string]any `json:"payload"`
		RedactedFields  []string       `json:"redacted_fields"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	switch {
	case req.Screen == "" || len([]rune(req.Screen)) > 200:
		s.fail(w, r, invalid("/screen", problem.FieldInvalid))
		return
	case req.TicketReference != nil && len([]rune(*req.TicketReference)) > 200:
		s.fail(w, r, invalid("/ticket_reference", problem.FieldInvalid))
		return
	case req.Payload == nil:
		s.fail(w, r, invalid("/payload", problem.FieldInvalid))
		return
	}
	if req.TicketReference != nil && *req.TicketReference == "" {
		req.TicketReference = nil
	}
	payload, err := json.Marshal(req.Payload)
	if err != nil || len(payload) > maxPayload {
		s.fail(w, r, invalid("/payload", problem.FieldInvalid))
		return
	}
	if req.RedactedFields == nil {
		req.RedactedFields = []string{}
	}
	id := idgen.New()
	if req.ID != nil {
		id = *req.ID
	}
	now := s.cfg.Now()
	expires := now.Add(BundlesKept)
	err = tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		if req.HouseholdID != nil {
			// Outside any household, a user reads their own memberships and nobody else's.
			var member bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM memberships WHERE household_id = $1 AND user_id = $2)",
				*req.HouseholdID, user).Scan(&member); err != nil {
				return err
			}
			if !member {
				return invalid("/household_id", problem.FieldInvalid)
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO diagnostic_bundles (id, user_id, household_id, screen, ticket_reference, payload, redacted_fields, created_at, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (id) DO NOTHING`,
			id, user, req.HouseholdID, req.Screen, req.TicketReference, payload, req.RedactedFields, now, expires)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			// The id is taken: by this bundle sent before, which is answered as it was, or by another's.
			err := tx.QueryRow(ctx, "SELECT expires_at FROM diagnostic_bundles WHERE id = $1 AND user_id = $2", id, user).Scan(&expires)
			if errors.Is(err, pgx.ErrNoRows) {
				return invalid("/id", problem.FieldInvalid)
			}
			if err != nil {
				return err
			}
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id, "expires_at": expires.UTC()})
}
