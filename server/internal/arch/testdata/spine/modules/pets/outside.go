package pets

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// owned reads the caller's memberships outside their household, as only the platform may.
func owned(ctx context.Context, tx pgx.Tx) error {
	return tenant.Outside(ctx, tx, func() error {
		_, err := tx.Exec(ctx, "SELECT household_id FROM memberships")
		return err
	})
}
