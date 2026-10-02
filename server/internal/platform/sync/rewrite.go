package sync

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AccessRewrite is the setting, local to a transaction, that names the columns the next update of an
// entity's rows rewrites (RewriteAccess): touch_entity then leaves each row's version, updated_by and
// updated_at as they were, and refuses an update that changes any other column (migration 01021,
// ADR 0018). Only RewriteAccess sets it; architecture test 4 fails a module that names it.
const AccessRewrite = "household.access_rewrite"

// RewriteAccess runs update, an UPDATE in tx of rows of an entity's table that sets only columns, the
// access the rows carry (AccessColumns), and returns how many rows it changed: the readers of the rows
// an audience bounds when its membership changes (D-90), and the visibility and owner of the rows a
// private item or root bounds when it moves between shared and private (D-88).
//
// A rewrite of the access a row carries is not an edit of it, and is neither versioned nor recorded:
// it changes who the row reaches, which the streams read from the row, and nothing its readers see of
// it. touch_entity leaves its version as it was, so that an edit a member queued against it, or sent
// under If-Match, still applies against the version they saw rather than turning into a conflict or a
// preserved loser, and refuses the update when it changes anything else. The mutation that changed the
// audience or the item records its own change, through the mutation spine, and PowerSync, reading the
// rewritten rows from the write-ahead log, moves each into or out of the buckets that now hold it.
func RewriteAccess(ctx context.Context, tx pgx.Tx, columns []string, update string, args ...any) (int64, error) {
	if len(columns) == 0 || slices.ContainsFunc(columns, func(c string) bool {
		return c != VisibilityColumn && c != OwnerColumn && c != ReadersColumn
	}) {
		return 0, fmt.Errorf("sync: a rewrite of the access a row carries rewrites %s, %s or %s, not %v",
			VisibilityColumn, OwnerColumn, ReadersColumn, columns)
	}
	if _, err := tx.Exec(ctx, "SELECT set_config($1, $2, true)", AccessRewrite, strings.Join(columns, ",")); err != nil {
		return 0, fmt.Errorf("sync: begin the rewrite: %w", err)
	}
	tag, err := tx.Exec(ctx, update, args...)
	if err != nil {
		return 0, fmt.Errorf("sync: rewrite %v: %w", columns, err)
	}
	// Every later update in tx is an edit again, versioned as touch_entity versions any.
	if _, err := tx.Exec(ctx, "SELECT set_config($1, '', true)", AccessRewrite); err != nil {
		return 0, fmt.Errorf("sync: end the rewrite: %w", err)
	}
	return tag.RowsAffected(), nil
}

// RemoveReader takes member out of the readers of every row of household that an audience of entities
// bounds, in tx (D-90): a member removed from the household, or gone from it, is in none of its
// audiences any longer, and readers left behind would reach them again were they ever brought back
// with the grant, in conversations they are no longer in. The membership's own removal retracts every
// other row from their replicas, since every stream looks their membership up.
func RemoveReader(ctx context.Context, tx pgx.Tx, entities []Entity, household, member uuid.UUID) error {
	for _, e := range entities {
		if e.Access&Audience == 0 {
			continue
		}
		table := pgx.Identifier(strings.Split(e.Table, ".")).Sanitize()
		if _, err := RewriteAccess(ctx, tx, []string{ReadersColumn}, fmt.Sprintf(
			"UPDATE %s SET %s = array_remove(%[2]s, $2) WHERE household_id = $1 AND $2 = ANY (%[2]s)", table, ReadersColumn),
			household, member); err != nil {
			return fmt.Errorf("sync: take %s out of the readers of %s: %w", member, e.Name, err)
		}
	}
	return nil
}
