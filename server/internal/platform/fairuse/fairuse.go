// Package fairuse holds the fair-use ceilings of PRD 04 §5 (plan item 16): what a household, and a
// user, may hold before it is a support conversation rather than an automatic charge. They exist to
// catch automation and abuse, not an enthusiastic family, and are far above what a family keeps.
//
// A ceiling on a count, of members, owned households, rows or objects, refuses the create that
// would pass it with 403 (D-116): the count never falls while a client waits, so a client told to
// wait and send again, as a 429 tells it, would send it again for ever. A module's rows are the rows
// the database holds, its tombstones among them until they are erased (storage.RowCeiling). A ceiling
// on a rate, of requests (ratelimit), answers 429. Each warns at 80 % first: the owners are told once,
// as the count crosses it.
package fairuse

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The ceilings on counts (PRD 04 §5). Rows and Objects are per household, Rows per module of it;
// Households is the households one user may own.
const (
	Members    = 12
	Households = 5
	Rows       = 250_000
	Objects    = 100_000
)

// SyncMutations is the mutations a household's replicas may push on one UTC day (PRD 04 §5): a
// ceiling on a rate, which the push answers 429 past, until the day ends (D-127).
const SyncMutations = 100_000

// The resources a refusal and a warning name, as the contract's FairUseProblem spells them.
const (
	ResourceMembers = "members"
	ResourceRows    = "rows"
	ResourceObjects = "objects"
)

// Warns reports whether count is at or above 80 % of ceiling, where the owners are warned.
func Warns(count, ceiling int64) bool { return count*5 >= ceiling*4 }

// Crossed reports whether going from before to after crossed 80 % of ceiling, upwards: the once the
// owners are warned.
func Crossed(before, after, ceiling int64) bool {
	return !Warns(before, ceiling) && Warns(after, ceiling)
}

// Refusal is the 403 fair_use_ceiling for a create that would take the household past ceiling of
// resource; module names the module whose rows they are, "" for any other resource.
func Refusal(resource string, ceiling int64, module string) *problem.Problem {
	p := problem.New(http.StatusForbidden, problem.CodeFairUseCeiling)
	p.Extensions = map[string]any{"resource": resource, "ceiling": ceiling}
	if module != "" {
		p.Extensions["module"] = module
	}
	return p
}

// HouseholdLimit is the 403 household_limit_reached for a user who owns Households already, which
// the contract names apart from the household's own ceilings.
func HouseholdLimit() *problem.Problem {
	p := problem.New(http.StatusForbidden, problem.CodeHouseholdLimitReached)
	p.Extensions = map[string]any{"ceiling": Households}
	return p
}

// message is the push that warns a household's owners.
const message = "notification.fair_use"

// Notice queues, in tx in household's context, the push that tells each of its owners it holds count
// of resource, of module's rows when the resource is rows, at 80 % of ceiling or more (Warns): once,
// where the count crosses it (Crossed). The caller nudges n once tx commits.
func Notice(ctx context.Context, tx pgx.Tx, n *notify.Service, household uuid.UUID, resource, module string, count, ceiling int64) error {
	return warn(ctx, tx, n, household, message, "fair_use:"+resource+":"+module,
		i18n.Args{"resource": resource, "module": module, "held": count, "ceiling": ceiling})
}

// syncMessage is the push that warns a household's owners of the mutations its replicas pushed today.
const syncMessage = "notification.fair_use_sync"

// SyncNotice queues, in tx in household's context, the push that tells each of its owners its
// replicas pushed count mutations today, 80 % of SyncMutations or more: once a day, where the count
// crosses it (Crossed). The caller nudges n once tx commits.
func SyncNotice(ctx context.Context, tx pgx.Tx, n *notify.Service, household uuid.UUID, count int64) error {
	return warn(ctx, tx, n, household, syncMessage, "fair_use:sync_mutations",
		i18n.Args{"held": count, "ceiling": int64(SyncMutations)})
}

// warn queues, in tx in household's context, msg with args to each of its owners, a household
// notification that links to it, its repeats coalesced under key.
func warn(ctx context.Context, tx pgx.Tx, n *notify.Service, household uuid.UUID, msg, key string, args i18n.Args) error {
	owners, err := tenant.Owners(ctx, tx, household)
	if err != nil {
		return err
	}
	ns := make([]notify.Notification, 0, len(owners))
	for _, o := range owners {
		ns = append(ns, notify.Notification{
			To: o, Category: notify.Household, Message: msg, Args: args,
			Link: "/households/" + household.String(), Coalesce: key,
		})
	}
	return n.Queue(ctx, tx, ns...)
}
