package module

import (
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// name is the form a module id takes: lowercase, English, a word or words joined by
// underscores (PRD modules/00 §1).
var name = regexp.MustCompile(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`)

// actionKey is the form an audit action's key takes: its module, then lowercase words joined
// by dots.
var actionKey = regexp.MustCompile(`^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$`)

// Registry is the modules compiled into the server, checked once at startup (PRD 01 §4), and the
// modules the platform serves itself (WithPlatform).
type Registry struct {
	modules  []Module
	byName   map[string]Module
	platform []PlatformModule
	blocks   []db.Block
	actions  map[string]AuditAction
	entities map[string]sync.Entity
}

// PlatformModule is a module the platform serves itself rather than a package under
// internal/modules: admin, the household's settings, members, invitations and module switches
// (plan item 10, ADR 0011), whose routes the contract puts at the household's root, whose tables
// are the platform's block's, and whose writes the platform makes for callers no module could
// serve, a household's creator and an invitation's holder. It declares the audit actions its
// mutations record and the sync entities they change, as a module does, so that the mutation spine
// records them; it is not among All, which are the modules mounted under /<name>.
type PlatformModule struct {
	Name     string
	Actions  []AuditAction
	Entities []sync.Entity
}

// WithPlatform returns a registry holding r's modules and mods, checked as NewRegistry checks a
// module's declarations: a name that is not a module id or is already registered, an audit
// action that is not the module's or is declared twice or without its summary key, and a sync
// entity that sync.Violations finds wrong are refused.
func (r *Registry) WithPlatform(mods ...PlatformModule) (*Registry, error) {
	out := &Registry{
		modules:  r.All(),
		byName:   map[string]Module{},
		platform: append([]PlatformModule(nil), r.Platform()...),
		blocks:   r.Blocks(),
		actions:  map[string]AuditAction{},
		entities: map[string]sync.Entity{},
	}
	if r != nil {
		maps.Copy(out.byName, r.byName)
		maps.Copy(out.actions, r.actions)
		maps.Copy(out.entities, r.entities)
	}
	for _, p := range mods {
		if !name.MatchString(p.Name) {
			return nil, fmt.Errorf("module: %q is not a module id: lowercase words joined by underscores", p.Name)
		}
		if out.registered(p.Name) {
			return nil, fmt.Errorf("module: two modules are named %s", p.Name)
		}
		out.platform = append(out.platform, p)
		if err := out.addActions(p.Name, p.Actions); err != nil {
			return nil, err
		}
		if err := out.addEntities(p.Name, p.Entities); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// registered reports whether a module or a platform module is named n.
func (r *Registry) registered(n string) bool {
	if _, ok := r.byName[n]; ok {
		return true
	}
	return slices.ContainsFunc(r.platform, func(p PlatformModule) bool { return p.Name == n })
}

// Platform returns the modules the platform serves itself, in the order they were added. A nil
// registry has none.
func (r *Registry) Platform() []PlatformModule {
	if r == nil {
		return nil
	}
	return append([]PlatformModule(nil), r.platform...)
}

// NewRegistry checks mods and returns their registry. It refuses a nil module, a name that is
// not a module id, two modules with one name, migrations that are not one block of the
// module's own under db.Assemble's rules, the platform's block included, an audit action that
// is not the module's or is declared twice or without its summary key, and a sync entity that
// sync.Violations finds wrong.
func NewRegistry(mods ...Module) (*Registry, error) {
	r := &Registry{
		byName:   make(map[string]Module, len(mods)),
		actions:  map[string]AuditAction{},
		entities: map[string]sync.Entity{},
	}
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
		if err := r.addActions(n, m.AuditActions()); err != nil {
			return nil, err
		}
		if source, ok := m.(SyncSource); ok {
			if err := r.addEntities(n, source.SyncEntities()); err != nil {
				return nil, err
			}
		}
	}
	if _, err := db.Assemble(append([]db.Block{db.Platform()}, r.blocks...)...); err != nil {
		return nil, fmt.Errorf("module: %w", err)
	}
	return r, nil
}

// addActions checks the audit actions of the module named module and adds them.
func (r *Registry) addActions(module string, actions []AuditAction) error {
	var errs []error
	for _, a := range actions {
		_, declared := r.actions[a.Key]
		switch {
		case !actionKey.MatchString(a.Key) || !strings.HasPrefix(a.Key, module+"."):
			errs = append(errs, fmt.Errorf("audit action %q is not %s.<action> in lowercase words joined by dots", a.Key, module))
		case declared:
			errs = append(errs, fmt.Errorf("audit action %s is declared twice", a.Key))
		case a.SummaryKey == "":
			errs = append(errs, fmt.Errorf("audit action %s has no summary key", a.Key))
		default:
			r.actions[a.Key] = a
		}
	}
	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("module: %s: %w", module, err)
	}
	return nil
}

// addEntities checks the sync entities of the module named module and adds them.
func (r *Registry) addEntities(module string, entities []sync.Entity) error {
	if v := sync.Violations(module, entities); len(v) > 0 {
		return fmt.Errorf("module: %s declares sync entities wrongly:\n  %s", module, strings.Join(v, "\n  "))
	}
	for _, e := range entities {
		r.entities[e.Name] = e
	}
	return nil
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

// Action returns the audit action whose key is key, "<module>.<action>".
func (r *Registry) Action(key string) (AuditAction, bool) {
	if r == nil {
		return AuditAction{}, false
	}
	a, ok := r.actions[key]
	return a, ok
}

// Entity returns the sync entity named n.
func (r *Registry) Entity(n string) (sync.Entity, bool) {
	if r == nil {
		return sync.Entity{}, false
	}
	e, ok := r.entities[n]
	return e, ok
}

// Entities returns every sync entity the modules declare, the platform's among them, ordered by
// name.
func (r *Registry) Entities() []sync.Entity {
	if r == nil {
		return nil
	}
	out := make([]sync.Entity, 0, len(r.entities))
	for _, e := range r.entities {
		out = append(out, e)
	}
	slices.SortFunc(out, func(a, b sync.Entity) int { return strings.Compare(a.Name, b.Name) })
	return out
}
