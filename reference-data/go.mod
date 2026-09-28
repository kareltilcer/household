// The reference data as a Go module, so the server embeds this directory's files themselves
// rather than a copy that could drift, as docs/api does for the contract and packages/i18n for
// the catalogs. server/go.mod requires it through a replace directive; nothing else is
// published from here.
module github.com/kareltilcer/household/reference-data

go 1.26.0
