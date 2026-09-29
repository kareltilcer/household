package household

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Name is the module id of the household's own settings, members and invitations: "Household
// settings" (PRD modules/17), which the platform serves itself.
const Name = "admin"

// The entities of admin (PRD modules/17 Sync, ADR 0011). Each is strict_version and never written
// offline: a client must never believe it can change its own permissions offline (D-80), and the
// rest are owners' structure, written online under If-Match. A membership carries its member's
// grants, so a grant's change is its membership's.
const (
	entitySettings   = Name + ".household_settings"
	entityMembership = Name + ".membership"
	entityModule     = Name + ".module_enablement"
	entityInvitation = Name + ".invitation"
)

// The audit actions of admin, each rendered by the translation key of the same name (FR-AU1).
const (
	actionCreate        = "household.create"
	actionUpdate        = "household.update"
	actionJoinCode      = "household.join_code"
	actionMemberJoin    = "member.join"
	actionMemberUpdate  = "member.update"
	actionMemberPromote = "member.promote"
	actionMemberRemove  = "member.remove"
	actionMemberLeave   = "member.leave"
	actionInviteCreate  = "invitation.create"
	actionInviteResend  = "invitation.resend"
	actionInviteRevoke  = "invitation.revoke"
	actionInviteDecline = "invitation.decline"
	actionModuleEnable  = "module.enable"
	actionModuleDisable = "module.disable"
)

// Admin is what admin declares to the module registry: the audit actions its mutations record and
// the sync entities they change, which the mutation spine checks every one of them against.
func Admin() module.PlatformModule {
	actions := []string{
		actionCreate, actionUpdate, actionJoinCode,
		actionMemberJoin, actionMemberUpdate, actionMemberPromote, actionMemberRemove, actionMemberLeave,
		actionInviteCreate, actionInviteResend, actionInviteRevoke, actionInviteDecline,
		actionModuleEnable, actionModuleDisable,
	}
	p := module.PlatformModule{Name: Name}
	for _, a := range actions {
		p.Actions = append(p.Actions, module.AuditAction{Key: Name + "." + a, SummaryKey: Name + "." + a})
	}
	p.Entities = []sync.Entity{
		{Name: entitySettings, Table: "households", Policy: sync.StrictVersion, Access: sync.Grant,
			Creates: []string{"postHouseholds"}},
		{Name: entityMembership, Table: "memberships", Policy: sync.StrictVersion, Access: sync.Grant},
		{Name: entityModule, Table: "module_enablement", Policy: sync.StrictVersion, Access: sync.Grant},
		{Name: entityInvitation, Table: "invitations", Policy: sync.StrictVersion, Access: sync.Grant,
			Creates: []string{"postInvitations"}},
	}
	return p
}

// Modules are the modules a household enables and grants, in the order of the contract's
// ModuleKeyValue, which lists are answered in and a test holds them to. Every one is enabled and
// granted from the household's creation, whether or not its package is built yet (PRD modules/00
// §6), and a module the database's modules table knows beyond them, a test's, is none of the
// household surface's.
var Modules = []string{
	"dashboard", "tasks", "reminders", "calendar", "shopping", "chores", "notes", "documents", "finance",
	"utilities", "garden", "property", "vehicles", "pets", "chat", "activity", Name,
}

// memberDefaults are a new member's levels (FR-AC3): open on what a household does together, closed
// on what it owns and spends. A module not named is none.
var memberDefaults = map[string]access.Level{
	"dashboard": access.Contribute, "tasks": access.Contribute, "reminders": access.Contribute,
	"calendar": access.Contribute, "shopping": access.Contribute, "chores": access.Contribute,
	"notes": access.Contribute, "chat": access.Contribute, "pets": access.Contribute,
	"documents": access.View, "activity": access.View, Name: access.View,
}

// childDefaults are a new child's levels (FR-AC4), for item 11's profiles. A module not named is
// none: Finance, Chat and the activity log among them.
var childDefaults = map[string]access.Level{
	"chores": access.Contribute, "shopping": access.Contribute, "calendar": access.Contribute,
	"tasks": access.Contribute, "pets": access.Contribute,
	"reminders": access.View, "dashboard": access.View,
}

// Defaults returns the levels a new member with role starts with on each of modules: Manage on
// every one for an owner, who holds it whatever is stored, and keeps it as a member if demoted; and
// FR-AC3's or FR-AC4's for a member or a child.
func Defaults(role access.Role, modules []string) map[string]access.Level {
	out := make(map[string]access.Level, len(modules))
	for _, m := range modules {
		switch role {
		case access.Owner:
			out[m] = access.Manage
		case access.Child:
			out[m] = childDefaults[m]
		case access.Member:
			out[m] = memberDefaults[m]
		}
	}
	return out
}

// Cause is why members lost access or had it changed.
type Cause string

// The causes of a change of access item 10 makes (PRD 03 §2.6's five causes, less the two a
// module makes: removal from an audience, and an item made private).
const (
	// CauseGrant is a role or grant lowered: the member keeps the household.
	CauseGrant Cause = "grant"
	// CauseModule is a module the household disabled, for everyone who could see it.
	CauseModule Cause = "module_disabled"
	// CauseRemoved is a member an owner removed from the household.
	CauseRemoved Cause = "removed"
	// CauseLeft is a member who left.
	CauseLeft Cause = "left"
)

// Loss is access members lost to one change: the modules each could see before and cannot now, or
// every module, for a member who is no longer in the household.
type Loss struct {
	Household uuid.UUID
	Cause     Cause
	// Members are who lost it, each with the modules they lost; nil for every module, when they
	// left the household or were removed from it.
	Members map[uuid.UUID][]string
}

// Change is a change of one member's access they are told of (D-78): a role or a grant changed, or
// their removal.
type Change struct {
	Household uuid.UUID
	Member    uuid.UUID
	Cause     Cause
}

// Hooks are what later items plug into the household surface, each nil until its item fills it in.
type Hooks struct {
	// Created runs in the transaction that creates a household, once its rows are written: item
	// 18 starts its trial there (FR-HH1). An error rolls the creation back.
	Created func(ctx context.Context, tx pgx.Tx, household uuid.UUID) error
	// Lost runs in the transaction of every change that takes access from members, the grant
	// lowered to none, the module disabled, the member removed or gone: item 14 retracts what
	// their replicas may no longer hold there (FR-SY7), and item 20 starts a leaving member's
	// private root's window (FR-PR7). An error rolls the change back.
	Lost func(ctx context.Context, tx pgx.Tx, loss Loss) error
	// Changed runs after a change of a member's role or grants, or their removal, commits: item 17
	// tells them (D-78, FR-HA5).
	Changed func(ctx context.Context, change Change)
}

// created runs the Created hook, when one is set.
func (h Hooks) created(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	if h.Created == nil {
		return nil
	}
	return h.Created(ctx, tx, household)
}

// lost runs the Lost hook for loss, when one is set and anyone lost anything.
func (h Hooks) lost(ctx context.Context, tx pgx.Tx, loss Loss) error {
	if h.Lost == nil || len(loss.Members) == 0 {
		return nil
	}
	return h.Lost(ctx, tx, loss)
}
