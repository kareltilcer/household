// Package db opens the server's PostgreSQL connections, creates the roles it connects as,
// applies its migrations (PRD 01 §2.3, §9), and names the refusals of PostgreSQL's that a
// caller answers as a problem of the request's rather than as a failure.
package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// uniqueViolationCode is PostgreSQL's SQLSTATE for unique_violation.
const uniqueViolationCode = "23505"

// UniqueViolation reports whether err is PostgreSQL's refusal of a row that constraint, a unique
// constraint or index, already has.
func UniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolationCode && pgErr.ConstraintName == constraint
}

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
