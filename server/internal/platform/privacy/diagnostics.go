package privacy

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// What a diagnostic bundle is held to as it is stored (D-142). Its rows are billed to nobody and no
// household's fair use counts them, so they need a ceiling of their own (PRD 04 §5): generous for a
// member who sends a few while a problem is looked into, and there to catch automation.
const (
	// maxPayload caps a bundle's payload: sync metadata, a few kilobytes of it, never a household's
	// content (PRD 10 §6).
	maxPayload = 256 << 10
	// maxRedacted caps how many fields a bundle says its member took out, and maxRedactedField each
	// one's name, in characters: with the payload they are all of a bundle that has no fixed size.
	maxRedacted      = 200
	maxRedactedField = 200
	// bundlesPerDay is how many bundles an account sends in bundlesWindow (PRD 02 §9).
	bundlesPerDay = 20
	bundlesWindow = 24 * time.Hour
)

// sendDiagnostics is postMeDiagnostics (FR-PS1, D-20): the bundle the member assembled, saw in full
// and chose to send is kept for 30 days, for platform staff to read (item 21), and is the only thing
// of a household that ever reaches them. The server keeps what it is sent and reads none of it: what
// goes in, sync metadata and no field values (PRD 10 §6), and what the member took out, are the
// client's, which shows it before it is sent. A bundle about a household names one its sender
// belongs to. The same bundle sent again, by its id, is kept once, and counts once: past twenty in a
// day, a new one is refused 429 until the oldest is a day old.
func (s *Service) sendDiagnostics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	// The payload is kept as its bytes were sent, never decoded and encoded again: a number read into
	// a float64 on the way would come back another number past 2^53, and the bundle would no longer
	// be what its member saw (D-142).
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
	case !redactedFit(req.RedactedFields):
		s.fail(w, r, invalid("/redacted_fields", problem.FieldInvalid))
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
		// One bundle of a user's at a time: the day's count is read, and the bundle written, under the
		// user's lock, as an export's is.
		if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR NO KEY UPDATE", user); err != nil {
			return err
		}
		// This bundle sent before is answered as it was, and counts for nothing more.
		err := tx.QueryRow(ctx, "SELECT expires_at FROM diagnostic_bundles WHERE id = $1 AND user_id = $2", id, user).Scan(&expires)
		if err == nil {
			return idempotency.Commit(ctx, tx)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var (
			recent int
			oldest *time.Time
		)
		if err := tx.QueryRow(ctx, "SELECT count(*), min(created_at) FROM diagnostic_bundles WHERE user_id = $1 AND created_at > $2",
			user, now.Add(-bundlesWindow)).Scan(&recent, &oldest); err != nil {
			return err
		}
		if recent >= bundlesPerDay {
			return ratelimit.Refusal(oldest.Add(bundlesWindow).Sub(now))
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
			// The id is taken, and not by a bundle of theirs: another's is nobody else's to take.
			return invalid("/id", problem.FieldInvalid)
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id, "expires_at": expires.UTC()})
}

// redactedFit reports whether fields, the names of what a bundle's member took out, are few and
// short enough to keep (maxRedacted, maxRedactedField).
func redactedFit(fields []string) bool {
	if len(fields) > maxRedacted {
		return false
	}
	for _, f := range fields {
		if len([]rune(f)) > maxRedactedField {
			return false
		}
	}
	return true
}
