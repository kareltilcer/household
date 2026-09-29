package pets

import (
	"context"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// adopt makes a scope of a household of its own choosing, as only the platform may.
func adopt(ctx context.Context, pool tenant.Beginner, household uuid.UUID) context.Context {
	return tenant.Assume(ctx, pool, household, uuid.Nil, access.Owner)
}
