package replica

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// clientJSON is the contract's Client: a replica of the household as it last reported itself, read
// as the client that reported it.
type clientJSON struct {
	ReplicaID uuid.UUID `json:"replica_id"`
	Member    memberRef `json:"member"`
	// Type and Version are what the report's Household-Client header named, nil for a report that
	// named no client, or made before the server kept it.
	Type *string `json:"type"`
	// Platform is the device's, nil for a browser and for a device that named none when it signed in.
	Platform   *string   `json:"platform"`
	Label      string    `json:"label"`
	Version    *string   `json:"version"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// memberRef is the contract's ActorRef, of the member a replica is.
type memberRef struct {
	UserID         uuid.UUID `json:"user_id"`
	Label          string    `json:"label"`
	IsFormerMember bool      `json:"is_former_member"`
}

// minimumsJSON is the contract's ClientList.minimum_versions: the oldest version of each client type
// the deployment serves, nil for a type it sets none for.
type minimumsJSON struct {
	Web    *string `json:"web"`
	Mobile *string `json:"mobile"`
}

// minimumsOf is minimums as an owner reads them.
func minimumsOf(minimums clientversion.Minimums) minimumsJSON {
	of := func(clientType string) *string {
		minimum, set := minimums[clientType]
		if !set {
			return nil
		}
		s := minimum.String()
		return &s
	}
	return minimumsJSON{Web: of(clientversion.Web), Mobile: of(clientversion.Mobile)}
}

// clientListJSON is the contract's ClientList.
type clientListJSON struct {
	Items           []clientJSON `json:"items"`
	MinimumVersions minimumsJSON `json:"minimum_versions"`
}

// clients is getClients (FR-HA18, plan item 27, ADR 0028): the household's clients and their
// versions, an owner's to read, for when a member reports something the others do not see. Anyone
// else is answered 404, as billing answers them: it is no part of a member's or a child's app (PRD
// modules/17, Permissions).
//
// A household's clients are the replicas that reported themselves in it, each member's and not the
// caller's alone, the one that reported last first: a device or a browser that synced this household,
// with the client its last report named. They are not the accounts' devices and sessions, which are
// no household's: those span every household a member is in, and would show an owner a member's phone
// that never opened this one. A device's platform is its account's record of it, read by the device
// the replica reported from, since a report does not say it. The member is one still: a replica's
// report leaves with their membership.
//
// Beside them are the oldest versions the deployment serves. There is no newest to be behind: the
// server knows what it refuses, and nothing of what was released since.
func (s *Reports) clients(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	if scope == nil {
		s.fail(ctx, w, tenant.ErrNoTenant)
		return
	}
	if scope.Role() != access.Owner {
		s.fail(ctx, w, problem.NotFound())
		return
	}
	out := clientListJSON{Items: []clientJSON{}, MinimumVersions: s.minimums}
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT r.id, r.user_id, u.display_name, r.client_type, d.platform, r.label, r.client_version, r.reported_at
			FROM sync_replicas r
			JOIN users u ON u.id = r.user_id
			LEFT JOIN devices d ON d.user_id = r.user_id AND d.id = r.device_id
			WHERE r.household_id = $1
			ORDER BY r.reported_at DESC, r.id`, scope.HouseholdID())
		if err != nil {
			return err
		}
		var (
			c        clientJSON
			reported time.Time
		)
		_, err = pgx.ForEachRow(rows, []any{&c.ReplicaID, &c.Member.UserID, &c.Member.Label, &c.Type, &c.Platform, &c.Label,
			&c.Version, &reported}, func() error {
			c.LastSeenAt = reported.UTC()
			out.Items = append(out.Items, c)
			return nil
		})
		return err
	})
	if err != nil {
		s.fail(ctx, w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
