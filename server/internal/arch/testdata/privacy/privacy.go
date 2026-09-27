// Package privacy holds modules for architecture test 3: one that exports and erases, and
// three that do not do both.
package privacy

import (
	"context"
	"io"
	"io/fs"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/module"
)

// Modules returns one of each.
func Modules() []module.Module {
	return []module.Module{complete{}, noExport{}, noErase{}, neither{}}
}

// contract is the part of the module contract the four share.
type contract struct{}

func (contract) Migrations() fs.FS                  { return nil }
func (contract) RegisterRoutes(chi.Router)          {}
func (contract) AuditActions() []module.AuditAction { return nil }

type complete struct{ contract }

func (complete) Name() string                                       { return "complete" }
func (complete) Export(context.Context, uuid.UUID, io.Writer) error { return nil }
func (complete) Erase(context.Context, uuid.UUID) error             { return nil }

type noExport struct{ contract }

func (noExport) Name() string                           { return "no_export" }
func (noExport) Erase(context.Context, uuid.UUID) error { return nil }

type noErase struct{ contract }

func (noErase) Name() string                                       { return "no_erase" }
func (noErase) Export(context.Context, uuid.UUID, io.Writer) error { return nil }

type neither struct{ contract }

func (neither) Name() string { return "neither" }
