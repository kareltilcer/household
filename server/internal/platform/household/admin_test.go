package household

import (
	"encoding/json"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/vectors"
)

// The defaults are PRD 02's tables, every module named: FR-AC3's for a member, FR-AC4's for a
// child, and Manage everywhere for an owner.
func TestTheDefaultsArePRD02s(t *testing.T) {
	levels := func(l access.Level, modules ...string) map[string]access.Level {
		out := map[string]access.Level{}
		for _, m := range modules {
			out[m] = l
		}
		return out
	}
	member := levels(access.None, "finance", "utilities", "garden", "property", "vehicles")
	maps.Copy(member, levels(access.Contribute, "dashboard", "tasks", "reminders", "calendar", "shopping", "chores", "notes", "chat", "pets"))
	maps.Copy(member, levels(access.View, "documents", "activity", "admin"))
	child := levels(access.None, "notes", "documents", "finance", "utilities", "garden", "property", "vehicles", "chat", "activity", "admin")
	maps.Copy(child, levels(access.Contribute, "chores", "shopping", "calendar", "tasks", "pets"))
	maps.Copy(child, levels(access.View, "reminders", "dashboard"))

	for role, want := range map[access.Role]map[string]access.Level{
		access.Owner: levels(access.Manage, Modules...), access.Member: member, access.Child: child,
	} {
		got := Defaults(role, Modules)
		if !maps.Equal(got, want) {
			t.Errorf("%s: %v, want %v", role, got, want)
		}
		for m, l := range got {
			if l > access.Ceiling(role, m) {
				t.Errorf("%s's default on %s, %v, is above its ceiling", role, m, l)
			}
		}
	}
}

// The shared vectors, run against the server's twin of @household/domain's grants (D-37): what a
// client draws of a role's defaults and its ceiling before it asks is what the server writes and
// refuses above.
func TestGrantVectors(t *testing.T) {
	vectors.Run(t, "grants", map[string]vectors.Subject{
		"defaults": func(in json.RawMessage) (any, error) {
			name, err := vectors.Decode[string](in)
			if err != nil {
				return nil, err
			}
			role, err := access.ParseRole(name)
			if err != nil {
				return nil, err
			}
			return Defaults(role, Modules), nil
		},
		"ceiling": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Role   string `json:"role"`
				Module string `json:"module"`
			}](in)
			if err != nil {
				return nil, err
			}
			role, err := access.ParseRole(v.Role)
			if err != nil {
				return nil, err
			}
			if !slices.Contains(Modules, v.Module) {
				return nil, fmt.Errorf("%q is no module", v.Module)
			}
			return access.Ceiling(role, v.Module), nil
		},
	}, func(error) string { return "" })
}

// A household code is eight characters of an alphabet without 0, O, 1 and I, and codes differ.
func TestAHouseholdCodeIsUnambiguous(t *testing.T) {
	code := regexp.MustCompile(`^[A-HJ-NP-Z2-9]{8}$`)
	seen := map[string]bool{}
	for range 1000 {
		c := newJoinCode()
		if !code.MatchString(c) {
			t.Fatalf("code %q", c)
		}
		seen[c] = true
	}
	if len(seen) < 999 {
		t.Errorf("%d codes of 1000 differ", len(seen))
	}
}

// Admin declares an action for every one its mutations record, and its entities as the registry
// takes them.
func TestAdminIsARegistrablePlatformModule(t *testing.T) {
	r, err := (&module.Registry{}).WithPlatform(Admin())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range []string{
		actionCreate, actionUpdate, actionJoinCode, actionMemberJoin, actionMemberUpdate, actionMemberPromote,
		actionMemberRemove, actionMemberLeave, actionInviteCreate, actionInviteResend, actionInviteRevoke,
		actionInviteDecline, actionModuleEnable, actionModuleDisable,
	} {
		if _, ok := r.Action(Name + "." + a); !ok {
			t.Errorf("admin.%s is not declared", a)
		}
	}
	var names []string
	for _, e := range r.Entities() {
		names = append(names, e.Name)
		if e.OfflineWrites {
			t.Errorf("%s is written offline; a client never changes its permissions offline (D-80)", e.Name)
		}
	}
	if want := []string{entitySettings, entityInvitation, entityMembership, entityModule}; !slices.Equal(names, want) {
		t.Errorf("entities %v, want %v", names, want)
	}
}
