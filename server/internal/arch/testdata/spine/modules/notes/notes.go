package notes

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Save writes around the spine.
func Save(ctx context.Context) error {
	return tenant.InWriteTx(ctx, func(pgx.Tx) error { return nil })
}

// Read reads, which it may.
func Read(ctx context.Context) error {
	return tenant.InTx(ctx, func(pgx.Tx) error { return nil })
}
