package files

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Attribution is who a file's bytes count against, and whether its entity is private to them
// (FR-ST1): only the module knows either, since only it knows whose its entity is. The storage
// picture splits the household's bytes by the member, and keeps a private entity's link and label
// from everyone else.
type Attribution struct {
	// Owner is the member, uuid.Nil for none, such as a system import's.
	Owner   uuid.UUID
	Private bool
}

// errPrivateUnowned is Record's answer to an attribution private to nobody.
var errPrivateUnowned = errors.New("files: a private file needs its owner")

// Record writes the metadata row of st, attributed as a says, in tx: the transaction of the
// mutation that records the upload, which commits the row with its audit event and its change
// (FR-FL1). It queues the derivation of the file's variants (FR-FL3), which runs once tx commits;
// Nudge runs it at once. A row already recording st, a retry's, is left as it is.
func Record(ctx context.Context, tx pgx.Tx, st Stored, a Attribution) error {
	if a.Private && a.Owner == uuid.Nil {
		return errPrivateUnowned
	}
	variants := "none"
	if st.typ.Derives() {
		variants = "pending"
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, filename, owner_id, private, variants)
		VALUES ($1, $2, $3, 'original', $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT DO NOTHING`,
		st.household, st.target.Module, st.target.Entity, st.typ.MIME, st.size, st.sha256[:], nullable(st.filename),
		owner(a.Owner), a.Private, variants)
	if err != nil || tag.RowsAffected() == 0 || variants != "pending" {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO file_jobs (household_id, kind, module, entity_id) VALUES ($1, 'variants', $2, $3)
		ON CONFLICT (household_id, kind, module, entity_id) DO UPDATE SET run_at = now(), attempts = 0, claim = NULL`,
		st.household, st.target.Module, st.target.Entity)
	return err
}

// Remove deletes the rows of every object of module's entity in tx, the transaction of the mutation
// that deletes the entity, and queues the purge of their bytes, which runs once tx commits; Nudge
// runs it at once. An entity with no objects is left as it is. Bytes a failed upload left, which no
// row records, go with the sweep.
func Remove(ctx context.Context, tx pgx.Tx, module string, entity uuid.UUID) error {
	scope := tenant.From(ctx)
	if scope == nil {
		return tenant.ErrNoTenant
	}
	household := scope.HouseholdID()
	tag, err := tx.Exec(ctx, "DELETE FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3",
		household, module, entity)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM file_jobs WHERE household_id = $1 AND kind = 'variants' AND module = $2 AND entity_id = $3`,
		household, module, entity); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO file_jobs (household_id, kind, module, entity_id) VALUES ($1, 'purge', $2, $3)
		ON CONFLICT (household_id, kind, module, entity_id) DO UPDATE SET run_at = now(), attempts = 0, claim = NULL`,
		household, module, entity)
	return err
}

// Attribute attributes every object of module's entity as a says, in tx: the transaction of the
// mutation that moves the entity between shared and private or hands it to another member.
//
// The original's row is locked first, as the workers lock it to record the variants they derived
// with its attribution (recordVariants): a variant a worker is recording meanwhile is then committed
// before the update reads the entity's rows, and is attributed with them, rather than left out of the
// update's snapshot, counting against the member the entity has left.
func Attribute(ctx context.Context, tx pgx.Tx, module string, entity uuid.UUID, a Attribution) error {
	scope := tenant.From(ctx)
	if scope == nil {
		return tenant.ErrNoTenant
	}
	if a.Private && a.Owner == uuid.Nil {
		return errPrivateUnowned
	}
	household := scope.HouseholdID()
	if _, err := tx.Exec(ctx, `
		SELECT FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original' FOR UPDATE`,
		household, module, entity); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE files SET owner_id = $4, private = $5 WHERE household_id = $1 AND module = $2 AND entity_id = $3`,
		household, module, entity, owner(a.Owner), a.Private)
	return err
}

// owner is a member's id as a row holds it, NULL for none.
func owner(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

// nullable is s as a row holds it, NULL for "".
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
