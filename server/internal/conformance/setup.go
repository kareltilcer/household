package conformance

import (
	"context"
	"database/sql"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Migrate applies the conformance module's block to the database migrate connects to as the
// migrate role, whose platform block `household-api migrate` has already applied, after `household-api
// bootstrap` made PowerSync's replication role and its bucket storage: the block publishes the
// module's tables for PowerSync as the platform's migrations publish theirs (replicate).
func Migrate(ctx context.Context, migrate *sql.DB) error {
	block, err := Block()
	if err != nil {
		return err
	}
	_, err = db.Migrate(ctx, migrate, db.Platform(), block)
	return err
}
