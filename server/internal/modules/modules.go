// Package modules lists the feature modules compiled into the server (PRD 01 §4). It is the
// one package that imports them all, and only the server's composition and the architecture
// tests import it: a module that did would reach every other module through it, and
// architecture test 1 fails one that does.
package modules

import "github.com/kareltilcer/household/server/internal/platform/module"

// All returns one of each module, in the order of the contract's ModuleKeyValue. Item 30 adds
// the first.
func All() []module.Module { return nil }
