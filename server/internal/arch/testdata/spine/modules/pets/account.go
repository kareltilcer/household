package pets

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// rename writes an account's row around the spine, as only the platform may.
func rename(ctx context.Context, pool tenant.Beginner) error {
	return tenant.AccountTx(ctx, pool, uuid.Nil, func(pgx.Tx) error { return nil })
}
