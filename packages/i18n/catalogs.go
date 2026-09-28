// Package catalogs carries the translation catalogs into the server binary. The server's
// renderer (internal/platform/i18n) reads them from here for emails, push notifications and
// audit summaries, in the recipient's language (PRD 03 §9), so it reads the very files the
// clients compile against: there is no second copy.
package catalogs

import "embed"

// FS holds catalogs/<locale>.json, one flat object of key to ICU message per locale.
//
//go:embed catalogs/*.json
var FS embed.FS
