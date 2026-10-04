package pets

import (
	"context"

	"github.com/kareltilcer/household/server/internal/platform/mutation"
)

// asStaff names a service as the actor of what the module writes, as only the platform may for its
// staff. Apply, which a module does call, is no violation.
func asStaff(ctx context.Context) context.Context {
	_ = mutation.Apply
	return mutation.AsService(ctx, mutation.Service{Label: "support"})
}
