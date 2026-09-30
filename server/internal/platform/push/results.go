package push

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/problem"
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

// answer is the answer to res's mutation, which carries what fp fingerprints, when k was kept for
// its id: k's own, when the mutation is the one k answered, and a refusal when the id was sent
// before carrying another mutation.
func (k kept) answer(res Result, fp []byte) Result {
	if !bytes.Equal(k.fingerprint, fp) {
		return reject(res, Refuse(problem.CodeValidationFailed, "mutation %s was sent before carrying another mutation", res.MutationID))
	}
	return k.result
}

// keptAnswers returns the answers kept for the caller's mutation ids in ctx's household, within
// their retention, by id, read in one transaction; an id with none kept has no entry.
func keptAnswers(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*kept, error) {
	scope := tenant.From(ctx)
	out := make(map[uuid.UUID]*kept, len(ids))
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT mutation_id, fingerprint, outcome, version, code, message, row FROM sync_mutations
			WHERE household_id = $1 AND user_id = $2 AND mutation_id = ANY($3) AND created_at > now() - make_interval(secs => $4)`,
			scope.HouseholdID(), scope.UserID(), ids, Retention.Seconds())
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var (
				k   kept
				row []byte
			)
			if err := rows.Scan(&k.result.MutationID, &k.fingerprint, &k.result.Outcome, &k.result.Version, &k.result.Code,
				&k.result.Message, &row); err != nil {
				return err
			}
			if row != nil {
				k.result.Row = json.RawMessage(row)
			}
			out[k.result.MutationID] = &k
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("push: read the kept answers: %w", err)
	}
	return out, nil
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
