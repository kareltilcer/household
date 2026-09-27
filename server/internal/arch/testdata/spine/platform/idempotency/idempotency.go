package idempotency

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// claim is the platform's own bookkeeping, which it may write.
func claim(ctx context.Context) error {
	return tenant.InWriteTx(ctx, func(pgx.Tx) error { return nil })
}
