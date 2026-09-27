package module

import (
	"fmt"
	"io/fs"
	"regexp"
	"strconv"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// name is the form a module id takes: lowercase, English, a word or words joined by
// underscores (PRD modules/00 §1).
var name = regexp.MustCompile(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`)

// Registry is the modules compiled into the server, checked once at startup (PRD 01 §4).
type Registry struct {
	modules []Module
	byName  map[string]Module
	blocks  []db.Block
}

// NewRegistry checks mods and returns their registry. It refuses a nil module, a name that is
// not a module id, two modules with one name, and migrations that are not one block of the
// module's own under db.Assemble's rules, the platform's block included.
func NewRegistry(mods ...Module) (*Registry, error) {
	r := &Registry{byName: make(map[string]Module, len(mods))}
	for i, m := range mods {
		if m == nil {
			return nil, fmt.Errorf("module: module %d is nil", i)
		}
		n := m.Name()
		if !name.MatchString(n) {
			return nil, fmt.Errorf("module: %q is not a module id: lowercase words joined by underscores", n)
		}
		if _, dup := r.byName[n]; dup {
			return nil, fmt.Errorf("module: two modules are named %s", n)
		}
		r.byName[n] = m
		r.modules = append(r.modules, m)

		block, ok, err := blockOf(m)
		if err != nil {
			return nil, err
		}
		if ok {
			r.blocks = append(r.blocks, block)
		}
	}
	if _, err := db.Assemble(append([]db.Block{db.Platform()}, r.blocks...)...); err != nil {
		return nil, fmt.Errorf("module: %w", err)
	}
	return r, nil
}

// blockOf returns m's migration block, numbered by its migrations' names, and false when m
// has no migrations. db.Assemble checks that every migration is numbered for the block.
func blockOf(m Module) (db.Block, bool, error) {
	fsys := m.Migrations()
	if fsys == nil {
		return db.Block{}, false, nil
	}
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return db.Block{}, false, fmt.Errorf("module: read the migrations of %s: %w", m.Name(), err)
	}
	if len(entries) == 0 {
		return db.Block{}, false, nil
	}
	first := entries[0].Name()
	number, err := strconv.Atoi(first[:min(2, len(first))])
	if err != nil {
		return db.Block{}, false, fmt.Errorf("module: %s holds %s, which is not named NNSSS_description.sql", m.Name(), first)
	}
	return db.Block{Name: m.Name(), Number: number, FS: fsys}, true, nil
}

// All returns the modules in the order they were registered. A nil registry has none.
func (r *Registry) All() []Module {
	if r == nil {
		return nil
	}
	return append([]Module(nil), r.modules...)
}

// Lookup returns the module named n.
func (r *Registry) Lookup(n string) (Module, bool) {
	if r == nil {
		return nil, false
	}
	m, ok := r.byName[n]
	return m, ok
}

// Blocks returns the modules' migration blocks, in the order the modules were registered. The
// platform's block is not among them: a migration applies db.Platform() and then these.
func (r *Registry) Blocks() []db.Block {
	if r == nil {
		return nil
	}
	return append([]db.Block(nil), r.blocks...)
}
