package fixture

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Seed writes the module's fixture around the spine.
func Seed(ctx context.Context) error {
	return tenant.InWriteTx(ctx, func(pgx.Tx) error { return nil })
}
