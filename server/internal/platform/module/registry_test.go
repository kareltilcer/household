package module_test

import (
	"io/fs"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// fake is a module with a name and migrations, and nothing else.
type fake struct {
	name       string
	migrations fs.FS
}

func (f fake) Name() string                     { return f.name }
func (f fake) Migrations() fs.FS                { return f.migrations }
func (fake) RegisterRoutes(chi.Router)          {}
func (fake) AuditActions() []module.AuditAction { return nil }

func migrations(names ...string) fs.FS {
	m := fstest.MapFS{}
	for _, n := range names {
		m[n] = &fstest.MapFile{Data: []byte("-- +goose Up\nSELECT 1;\n")}
	}
	return m
}

func TestTheRegistryHoldsItsModulesAndTheirBlocks(t *testing.T) {
	garden := &fake{"garden", migrations("20001_beds.sql", "20002_plantings.sql")}
	chat := &fake{"chat", nil}
	notes := &fake{"notes", migrations()}
	r, err := module.NewRegistry(garden, chat, notes)
	if err != nil {
		t.Fatal(err)
	}
	if got := r.All(); !slices.Equal(got, []module.Module{garden, chat, notes}) {
		t.Errorf("All: %v", got)
	}
	if m, ok := r.Lookup("chat"); !ok || m != module.Module(chat) {
		t.Errorf("Lookup(chat): %v, %v", m, ok)
	}
	if _, ok := r.Lookup("finance"); ok {
		t.Error("Lookup found a module nobody registered")
	}
	blocks := r.Blocks()
	if len(blocks) != 1 || blocks[0].Name != "garden" || blocks[0].Number != 20 {
		t.Fatalf("Blocks: %+v", blocks)
	}
	if _, err := db.Assemble(append([]db.Block{db.Platform()}, blocks...)...); err != nil {
		t.Fatal(err)
	}

	var none *module.Registry
	if none.All() != nil || none.Blocks() != nil {
		t.Error("a nil registry holds something")
	}
	if _, ok := none.Lookup("garden"); ok {
		t.Error("a nil registry found a module")
	}
}

func TestTheRegistryRefusesWhatIsNotAModule(t *testing.T) {
	for name, tc := range map[string]struct {
		modules []module.Module
		want    string
	}{
		"a nil module":         {[]module.Module{nil}, "module 0 is nil"},
		"an empty name":        {[]module.Module{fake{"", nil}}, `"" is not a module id`},
		"an uppercase name":    {[]module.Module{fake{"Garden", nil}}, `"Garden" is not a module id`},
		"a name with a hyphen": {[]module.Module{fake{"garden-plan", nil}}, "is not a module id"},
		"one name twice":       {[]module.Module{fake{"garden", nil}, fake{"garden", nil}}, "two modules are named garden"},
		"the platform's block": {[]module.Module{fake{"garden", migrations("01009_beds.sql")}}, "share number 1"},
		"one block twice": {
			[]module.Module{fake{"garden", migrations("20001_beds.sql")}, fake{"finance", migrations("20002_accounts.sql")}},
			"share number 20",
		},
		"a migration of another block": {[]module.Module{fake{"garden", migrations("20001_beds.sql", "21001_plots.sql")}}, "numbered for block 21"},
		"a file that is no migration":  {[]module.Module{fake{"garden", migrations("README.md")}}, "not named NNSSS_description.sql"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := module.NewRegistry(tc.modules...)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("NewRegistry: %v, want an error saying %q", err, tc.want)
			}
		})
	}
}

// declaring is a module that declares audit actions and sync entities.
type declaring struct {
	fake
	actions  []module.AuditAction
	entities []sync.Entity
}

func (d declaring) AuditActions() []module.AuditAction { return d.actions }
func (d declaring) SyncEntities() []sync.Entity        { return d.entities }

func TestTheRegistryHoldsWhatModulesDeclare(t *testing.T) {
	create := module.AuditAction{Key: "garden.planting.create", SummaryKey: "garden.planting.create"}
	planting := sync.Entity{Name: "garden.planting", Table: "garden_plantings", Policy: sync.LWWField, Access: sync.Grant}
	bed := sync.Entity{Name: "garden.bed", Table: "garden_beds", Policy: sync.StrictVersion, Access: sync.Grant}
	r, err := module.NewRegistry(declaring{fake{"garden", nil}, []module.AuditAction{create}, []sync.Entity{planting, bed}})
	if err != nil {
		t.Fatal(err)
	}
	if a, ok := r.Action("garden.planting.create"); !ok || a != create {
		t.Errorf("Action: %+v, %v", a, ok)
	}
	if _, ok := r.Action("garden.planting.delete"); ok {
		t.Error("Action found an action nobody declared")
	}
	if e, ok := r.Entity("garden.planting"); !ok || e.Table != planting.Table {
		t.Errorf("Entity: %+v, %v", e, ok)
	}
	if got := r.Entities(); len(got) != 2 || got[0].Name != "garden.bed" || got[1].Name != "garden.planting" {
		t.Errorf("Entities: %+v", got)
	}
	var none *module.Registry
	if _, ok := none.Action("garden.planting.create"); ok {
		t.Error("a nil registry found an action")
	}
	if _, ok := none.Entity("garden.planting"); ok || none.Entities() != nil {
		t.Error("a nil registry found an entity")
	}
}

func TestTheRegistryRefusesWhatAModuleDeclaresWrongly(t *testing.T) {
	good := sync.Entity{Name: "garden.planting", Table: "garden_plantings", Policy: sync.LWWField, Access: sync.Grant}
	for name, tc := range map[string]struct {
		actions  []module.AuditAction
		entities []sync.Entity
		want     string
	}{
		"another module's action":   {[]module.AuditAction{{Key: "notes.page.create", SummaryKey: "x"}}, nil, `"notes.page.create" is not garden.<action>`},
		"an unqualified action":     {[]module.AuditAction{{Key: "garden", SummaryKey: "x"}}, nil, `"garden" is not garden.<action>`},
		"an action twice":           {[]module.AuditAction{{Key: "garden.bed.create", SummaryKey: "x"}, {Key: "garden.bed.create", SummaryKey: "y"}}, nil, "declared twice"},
		"an action with no summary": {[]module.AuditAction{{Key: "garden.bed.create"}}, nil, "has no summary key"},
		"an entity with no policy": {nil, []sync.Entity{good, {Name: "garden.bed", Table: "garden_beds", Access: sync.Grant}},
			"garden.bed: no merge policy"},
		// Held to every member, a module's rows would reach a member it is absent for: one whose grant
		// on it is none, and every member while the household disables it.
		"an entity held to every member": {nil, []sync.Entity{good, {Name: "garden.climate", Table: "garden_climates", Policy: sync.StrictVersion,
			Access: sync.Members}}, "garden.climate: access to every member of the household, which only the platform's own entities hold"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := module.NewRegistry(declaring{fake{"garden", nil}, tc.actions, tc.entities})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("NewRegistry: %v, want an error saying %q", err, tc.want)
			}
		})
	}
}

// A module the platform serves itself is held to a module's rules, declares its actions and
// entities beside the modules', among them one held to every member of the household, which no
// module's may be, and is not among the modules mounted under /<name>.
func TestAPlatformModuleIsDeclaredBesideTheModules(t *testing.T) {
	garden := &fake{"garden", nil}
	r, err := module.NewRegistry(garden)
	if err != nil {
		t.Fatal(err)
	}
	admin := module.PlatformModule{
		Name:    "admin",
		Actions: []module.AuditAction{{Key: "admin.member.join", SummaryKey: "admin.member.join"}},
		Entities: []sync.Entity{
			{Name: "admin.membership", Table: "memberships", Policy: sync.StrictVersion, Access: sync.Members},
			{Name: "admin.invitation", Table: "invitations", Policy: sync.StrictVersion, Access: sync.Grant},
		},
	}
	withAdmin, err := r.WithPlatform(admin)
	if err != nil {
		t.Fatal(err)
	}
	if got := withAdmin.All(); !slices.Equal(got, []module.Module{garden}) {
		t.Errorf("All: %v", got)
	}
	if got := withAdmin.Platform(); len(got) != 1 || got[0].Name != "admin" {
		t.Errorf("Platform: %+v", got)
	}
	if _, ok := withAdmin.Action("admin.member.join"); !ok {
		t.Error("the platform module's action is not declared")
	}
	if _, ok := withAdmin.Entity("admin.membership"); !ok {
		t.Error("the platform module's entity is not declared")
	}
	if _, ok := r.Action("admin.member.join"); ok {
		t.Error("the registry it was made from changed")
	}

	for name, p := range map[string]module.PlatformModule{
		"a module's name":           {Name: "garden"},
		"a name that is no id":      {Name: "Admin"},
		"another module's action":   {Name: "admin", Actions: []module.AuditAction{{Key: "garden.bed.create", SummaryKey: "k"}}},
		"an action with no summary": {Name: "admin", Actions: []module.AuditAction{{Key: "admin.x"}}},
		"an entity with no policy":  {Name: "admin", Entities: []sync.Entity{{Name: "admin.x", Table: "x", Access: sync.Grant}}},
	} {
		if _, err := r.WithPlatform(p); err == nil {
			t.Errorf("%s was taken", name)
		}
	}
	if _, err := withAdmin.WithPlatform(admin); err == nil || !strings.Contains(err.Error(), "two modules are named admin") {
		t.Errorf("admin twice: %v", err)
	}
}
