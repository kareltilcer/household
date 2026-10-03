package privacy

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

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
	// The payload is kept as its bytes were sent, never decoded and encoded again: a number read into
	// a float64 on the way would come back another number past 2^53, and the bundle would no longer
	// be what its member saw (D-136).
	var req struct {
		ID              *uuid.UUID      `json:"id"`
		Screen          string          `json:"screen"`
		HouseholdID     *uuid.UUID      `json:"household_id"`
		TicketReference *string         `json:"ticket_reference"`
		Payload         json.RawMessage `json:"payload"`
		RedactedFields  []string        `json:"redacted_fields"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	payload := bytes.TrimSpace(req.Payload)
	switch {
	case req.Screen == "" || len([]rune(req.Screen)) > 200:
		s.fail(w, r, invalid("/screen", problem.FieldInvalid))
		return
	case req.TicketReference != nil && len([]rune(*req.TicketReference)) > 200:
		s.fail(w, r, invalid("/ticket_reference", problem.FieldInvalid))
		return
	case len(payload) == 0 || payload[0] != '{' || len(payload) > maxPayload:
		// An object, which the edge has held it to already, and one of a size worth keeping.
		s.fail(w, r, invalid("/payload", problem.FieldInvalid))
		return
	}
	if req.TicketReference != nil && *req.TicketReference == "" {
		req.TicketReference = nil
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
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
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
