package household

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// InvitationsKept is how long an invitation is kept once it stopped working, expired, declined,
// withdrawn or used up, so that its owners can still see it and send it again (D-110). The expiry
// sweep deletes it then, and the address it was sent to with it.
const InvitationsKept = 30 * 24 * time.Hour

// ended returns the condition on invitations i of one that stopped working longer ago than the
// seconds in parameter p: a pending one at its time, any other when its status last changed.
func ended(p string) string {
	return `((i.status <> 'pending' AND i.updated_at < now() - make_interval(secs => ` + p + `))
	  OR (i.status = 'pending' AND i.expires_at < now() - make_interval(secs => ` + p + `)))`
}

// Querier runs a query: the meter role's pool.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// PurgeInvitations deletes every household's invitations that stopped working InvitationsKept ago, as
// the meter role finds them (D-110): each through the mutation spine, as the system, recording
// admin.invitation.purge and the invitation's deletion, which takes it off every replica that holds
// it. catalog is the module registry the mutations are checked against. It returns how many it
// deleted; a household that fails is logged and the rest are purged, and every failure is returned.
func (s *Service) PurgeInvitations(ctx context.Context, meter Querier, catalog *module.Registry) (int, error) {
	rows, err := meter.Query(ctx, "SELECT DISTINCT i.household_id FROM invitations i WHERE "+ended("$1"), InvitationsKept.Seconds())
	if err != nil {
		return 0, err
	}
	households, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	var (
		purged int
		failed error
	)
	for _, household := range households {
		n, err := s.purgeInvitations(ctx, household, catalog)
		purged += n
		if err != nil {
			s.Log.LogAttrs(ctx, slog.LevelError, "household: purge ended invitations", slog.String("household_id", household.String()),
				slog.Any("error", err))
			failed = errors.Join(failed, err)
		}
		if ctx.Err() != nil {
			return purged, ctx.Err()
		}
	}
	return purged, failed
}

// purgeInvitations deletes household's invitations that stopped working InvitationsKept ago, one
// mutation each, and returns how many it deleted.
func (s *Service) purgeInvitations(ctx context.Context, household uuid.UUID, catalog *module.Registry) (int, error) {
	scoped := mutation.WithVia(mutation.WithCatalog(tenant.Assume(ctx, s.Pool, household, uuid.Nil, ""), catalog), audit.ViaSystem)
	var ids []uuid.UUID
	if err := tenant.InTx(scoped, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT i.id FROM invitations i WHERE i.household_id = $1 AND "+ended("$2")+" ORDER BY i.id",
			household, InvitationsKept.Seconds())
		if err != nil {
			return err
		}
		ids, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		return err
	}); err != nil {
		return 0, err
	}
	purged := 0
	for _, id := range ids {
		res, err := mutation.Apply(scoped, func(tx pgx.Tx) (mutation.Record, error) {
			var (
				version int64
				kind    string
				email   *string
			)
			// Read again as it is deleted: an owner who sent it again since has made it work again.
			err := tx.QueryRow(ctx, `
				DELETE FROM invitations i WHERE i.id = $1 AND `+ended("$2")+`
				RETURNING i.version, i.kind::text, i.email`, id, InvitationsKept.Seconds()).Scan(&version, &kind, &email)
			if errors.Is(err, pgx.ErrNoRows) {
				return mutation.Record{}, nil
			}
			if err != nil {
				return mutation.Record{}, err
			}
			return mutation.Record{
				Event: audit.Event{
					Module: Name, Action: actionInvitePurge, EntityType: entityInvitation, EntityID: id,
					SummaryKey: Name + "." + actionInvitePurge, SummaryArgs: invitationArgs(invitation{kind: kind, email: email}),
				},
				Changes: []sync.Change{{Entity: entityInvitation, ID: id, Op: sync.Delete, Version: version + 1}},
			}, nil
		})
		if err != nil {
			return purged, err
		}
		if res.EventID != uuid.Nil {
			purged++
		}
	}
	return purged, nil
}
