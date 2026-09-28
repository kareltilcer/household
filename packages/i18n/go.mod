// The catalogs as a Go module, so the server embeds this directory's catalogs/*.json
// themselves rather than a copy that could drift, as docs/api does for the contract.
// server/go.mod requires it through a replace directive; nothing else is published from here.
module github.com/kareltilcer/household/packages/i18n

go 1.26.0
