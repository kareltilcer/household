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
