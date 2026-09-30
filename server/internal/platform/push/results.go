package push

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Retention is how long a mutation's answer is kept: FR-SY5's 7 days, past which a mutation sent
// again is run again.
const Retention = 7 * 24 * time.Hour

// Result is the answer to one mutation, the contract's SyncMutationResult.
type Result struct {
	MutationID uuid.UUID `json:"mutation_id"`
	Outcome    string    `json:"outcome"`
	Version    *int64    `json:"version"`
	Row        any       `json:"row,omitempty"`
	Code       *string   `json:"code"`
	Message    *string   `json:"message"`
}

// The outcomes of a mutation (PRD 03 §2.4). This item's push answers applied, rejected and
// deferred; merged and conflict are item 14's, for the policies that produce them.
const (
	Applied  = "applied"
	Merged   = "merged"
	Conflict = "conflict"
	Rejected = "rejected"
	Deferred = "deferred"
)

// fingerprint is what makes two deliveries one mutation: everything it carries but its id.
func fingerprint(m In) ([]byte, error) {
	// A map's keys marshal in order, and a raw value compacted, so the same fields give the same
	// bytes whatever order and spacing they arrived in.
	fields, err := json.Marshal(m.Fields)
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	base := ""
	if m.BaseVersion != nil {
		base = strconv.FormatInt(*m.BaseVersion, 10)
	}
	action, clientTime := "", ""
	if m.Action != nil {
		action = *m.Action
	}
	if m.ClientTime != nil {
		clientTime = m.ClientTime.UTC().Format(time.RFC3339Nano)
	}
	for _, part := range []string{m.EntityType, m.EntityID.String(), m.Op, base, action, clientTime} {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	h.Write(fields)
	return h.Sum(nil), nil
}

// kept is an answer kept for a mutation, and what the mutation it answered carried.
type kept struct {
	fingerprint []byte
	result      Result
}

// lookup returns the answer kept for the caller's mutation id in ctx's household, within its
// retention, and false when there is none.
func lookup(ctx context.Context, tx pgx.Tx, id uuid.UUID) (kept, bool, error) {
	scope := tenant.From(ctx)
	var (
		k       kept
		row     []byte
		version *int64
	)
	k.result.MutationID = id
	err := tx.QueryRow(ctx, `
		SELECT fingerprint, outcome, version, code, message, row FROM sync_mutations
		WHERE household_id = $1 AND user_id = $2 AND mutation_id = $3 AND created_at > now() - make_interval(secs => $4)`,
		scope.HouseholdID(), scope.UserID(), id, Retention.Seconds()).
		Scan(&k.fingerprint, &k.result.Outcome, &version, &k.result.Code, &k.result.Message, &row)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return kept{}, false, nil
	case err != nil:
		return kept{}, false, fmt.Errorf("push: read a kept answer: %w", err)
	}
	k.result.Version = version
	if row != nil {
		k.result.Row = json.RawMessage(row)
	}
	return k, true, nil
}

// keep writes res, the answer that ended the caller's mutation, with the mutation's fingerprint, in
// tx, and reports whether it was written: false when another delivery of the mutation kept its
// answer first, which then stands. One kept past its retention is replaced.
func keep(ctx context.Context, tx pgx.Tx, fp []byte, res Result) (bool, error) {
	scope := tenant.From(ctx)
	var row []byte
	if res.Row != nil {
		var err error
		if row, err = json.Marshal(res.Row); err != nil {
			return false, fmt.Errorf("push: serialise an answer's row: %w", err)
		}
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO sync_mutations (household_id, user_id, mutation_id, fingerprint, outcome, version, code, message, row)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (household_id, user_id, mutation_id) DO UPDATE
		  SET fingerprint = excluded.fingerprint, outcome = excluded.outcome, version = excluded.version,
		      code = excluded.code, message = excluded.message, row = excluded.row, created_at = now()
		  WHERE sync_mutations.created_at <= now() - make_interval(secs => $10)`,
		scope.HouseholdID(), scope.UserID(), res.MutationID, fp, res.Outcome, res.Version, res.Code, res.Message, row,
		Retention.Seconds())
	if err != nil {
		return false, fmt.Errorf("push: keep an answer: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
