// Package referencedata carries the reference data into the server binary. The server's loader
// (internal/platform/reference) validates these files against their schemas and writes them into
// the global reference tables when it migrates (D-61, D-70), so what CI checked is what loads:
// there is no second copy.
package referencedata

import "embed"

// FS holds sources.json, the schemas and every dataset's files, at the paths they have here.
//
//go:embed sources.json schemas countries units
var FS embed.FS
