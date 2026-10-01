package notify

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Send queues ns in a transaction of their own, in household's context, as the system, and wakes the
// workers: a test's stand-in for the transaction of a cause, which is where everything else queues.
func (s *Service) Send(ctx context.Context, household uuid.UUID, ns ...Notification) error {
	scoped := s.system(ctx, household)
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error { return s.Queue(scoped, tx, ns...) }); err != nil {
		return err
	}
	s.Nudge(ctx, household)
	return nil
}
