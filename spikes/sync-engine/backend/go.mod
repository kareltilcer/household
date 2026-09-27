// The spike's backend (plan item 5). Throwaway. Its module path sits under the server's so
// that it may import the server's internal packages: the writes it takes go through the real
// tenant middleware and mutation spine, on item 4's schema.
module github.com/kareltilcer/household/server/spikesync

go 1.26.0

toolchain go1.26.8

require (
	github.com/go-chi/chi/v5 v5.3.2
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.11.0
	github.com/kareltilcer/household/server v0.0.0-00010101000000-000000000000
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/pressly/goose/v3 v3.28.0 // indirect
	github.com/sethvargo/go-retry v0.4.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/text v0.42.0 // indirect
)

replace (
	github.com/kareltilcer/household/docs/api => ../../../docs/api
	github.com/kareltilcer/household/server => ../../../server
)
