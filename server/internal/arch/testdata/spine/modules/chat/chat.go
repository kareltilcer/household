// Package chat sets the access rewrite itself, which architecture test 4 must catch: only
// sync.RewriteAccess may, which holds an update to the access columns.
package chat

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// Hide rewrites a message's body without moving its version.
func Hide(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, "SELECT set_config('household.access_rewrite', 'body', true)"); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, "UPDATE chat_messages SET body = ''")
	return err
}
