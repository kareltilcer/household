package pets

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	spine "github.com/kareltilcer/household/server/internal/platform/mutation"
)

// remark records an event with no change beside it, under another name for the package, as only the
// platform may.
func remark(ctx context.Context, tx pgx.Tx) error {
	_, err := spine.Note(ctx, tx, audit.Event{Module: "pets", Action: "pet.remark", SummaryKey: "pets.pet.remark"})
	return err
}
