package files

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Target is the entity an upload is the original of.
type Target struct {
	// Module is the module that keeps the entity, whose prefix the bytes go under.
	Module string
	Entity uuid.UUID
	// Field names Entity in the request, "/id" for a form's id field: the 422 that refuses an
	// entity whose original is other bytes names it.
	Field string
}

// Stored is an upload's bytes in the store, under its entity's original's key, for Record to
// record.
type Stored struct {
	household uuid.UUID
	target    Target
	typ       Type
	size      int64
	sha256    [32]byte
	filename  string
}

// Type is the stored bytes' type.
func (st Stored) Type() Type { return st.typ }

// Size is the stored bytes' length.
func (st Stored) Size() int64 { return st.size }

// SHA256 is the stored bytes' digest.
func (st Stored) SHA256() [32]byte { return st.sha256 }

// Put writes u's bytes to the store as the original of t's entity in ctx's household (FR-FL1). It
// answers, as problems:
//
//   - 402 storage_ceiling_reached, an upload that would take the household past its storage ceiling
//     (FR-FL4, D-33), naming by how much; below the ceiling an upload always succeeds;
//   - 422 validation_failed naming t.Field, an entity whose original is other bytes, since bytes are
//     write-once and a changed file is a new entity;
//   - 502 storage_unavailable, a store that cannot be reached, which the client retries (FR-NF3).
//
// The same bytes put again, a retry of an upload whose answer was lost, succeed and store nothing
// twice. The ceiling is checked against what the household stores now, as its rows record it: two
// uploads at once may take it past by the smaller of them.
func (s *Service) Put(ctx context.Context, u *Upload, t Target) (Stored, error) {
	scope := tenant.From(ctx)
	if scope == nil {
		return Stored{}, tenant.ErrNoTenant
	}
	household := scope.HouseholdID()
	st := Stored{household: household, target: t, typ: u.Type, size: u.Size, sha256: u.SHA256, filename: u.Filename}
	var (
		recorded []byte
		used     int64
	)
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT sha256 FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original'`,
			household, t.Module, t.Entity).Scan(&recorded)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return tx.QueryRow(ctx, "SELECT coalesce(sum(byte_size), 0) FROM files WHERE household_id = $1", household).Scan(&used)
	})
	switch {
	case err != nil:
		return Stored{}, err
	case recorded != nil && bytes.Equal(recorded, u.SHA256[:]):
		return st, nil
	case recorded != nil:
		return Stored{}, taken(t.Field)
	}
	if ceiling := s.allowance.Ceiling(); used+u.Size > ceiling {
		return Stored{}, s.overCeiling(ctx, household, used+u.Size-ceiling)
	}
	// Bytes the same as these, written before and never recorded, are a retry's of an upload whose
	// mutation did not commit.
	key := Key(household, t.Module, t.Entity, Original)
	err = s.store.PutSame(ctx, key, u.Reader(), u.Size, objectstore.Object{ContentType: u.Type.MIME, SHA256: u.SHA256})
	if errors.Is(err, objectstore.ErrExists) {
		return Stored{}, taken(t.Field)
	}
	if err != nil {
		if ctx.Err() != nil {
			return Stored{}, ctx.Err()
		}
		s.log.LogAttrs(ctx, slog.LevelWarn, "files: the object store refused an upload", slog.Any("error", err))
		return Stored{}, problem.New(http.StatusBadGateway, problem.CodeStorageUnavailable)
	}
	return st, nil
}

// taken is the 422 for an entity whose original is other bytes.
func taken(field string) *problem.Problem {
	return problem.Validation(problem.FieldError{Field: field, Code: problem.FieldInvalid})
}

// Remedy is what the 402 for the ceiling tells a client to do (the contract's EntitlementProblem).
const freeStorage = "free_storage"

// defaultState is the entitlement state a 402 names before item 16 keeps one: a household's trial
// starts with it (FR-HH1).
const defaultState = "trialing"

// overCeiling is the 402 for an upload over the storage ceiling by over bytes.
func (s *Service) overCeiling(ctx context.Context, household uuid.UUID, over int64) error {
	state := defaultState
	if s.state != nil {
		var err error
		if state, err = s.state(ctx, household); err != nil {
			return err
		}
	}
	p := problem.New(http.StatusPaymentRequired, problem.CodeStorageCeilingReached)
	p.Extensions = map[string]any{
		"state": state, "remedy": freeStorage, "over_by_bytes": over, "blocks_at_ceiling": s.allowance.MaxBlocks,
	}
	return p
}
