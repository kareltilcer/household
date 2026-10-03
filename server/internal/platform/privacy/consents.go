package privacy

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/identity"
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
