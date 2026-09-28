// Package summaries holds a module's audit actions for the summary check to read: one whose
// summary key the catalogs have, and one whose key they do not.
package summaries

import "github.com/kareltilcer/household/server/internal/platform/module"

// Module declares the actions.
type Module struct{}

// Name is the module's id.
func (Module) Name() string { return "shopping" }

// AuditActions are one action that keeps the rule and one that breaks it.
func (Module) AuditActions() []module.AuditAction {
	return []module.AuditAction{
		// Keeps it: a key the catalogs have, standing in for a real summary.
		{Key: "shopping.list.rename", SummaryKey: "module.shopping.name"},
		{Key: "shopping.list.create", SummaryKey: "shopping.list.create"},
	}
}
