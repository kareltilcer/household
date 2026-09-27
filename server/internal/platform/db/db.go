// Package db opens the server's PostgreSQL connections, creates the roles it connects as,
// and applies its migrations (PRD 01 §2.3, §9).
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Open returns a pool for url, which names the database and the role. Connections are
// made lazily, so an unreachable database fails readiness, not startup. Each session runs
// in UTC, so an instant cast to text is never rendered in a server's local zone; calendar
// days are converted in the household's timezone, which the session never assumes.
func Open(ctx context.Context, url, applicationName string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("db: parse the connection string: %w", err)
	}
	params := cfg.ConnConfig.RuntimeParams
	if params["application_name"] == "" {
		params["application_name"] = applicationName
	}
	params["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: open a pool: %w", err)
	}
	return pool, nil
}
