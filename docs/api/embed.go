// Package apispec carries openapi.yaml, the HTTP contract, into the server binary. The
// server validates request bodies against it at the edge, its tests validate responses
// against it, and architecture test 6 diffs the routes against it, all from these bytes:
// the committed document is the only copy there is.
package apispec

import _ "embed"

// OpenAPI is the bundled openapi.yaml, byte for byte.
//
//go:embed openapi.yaml
var OpenAPI []byte
