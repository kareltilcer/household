// The contract as a Go module, so the server embeds this directory's openapi.yaml itself
// rather than a copy of it that could drift. server/go.mod requires it through a replace
// directive; nothing else is published from here.
module github.com/kareltilcer/household/docs/api

go 1.26.0
