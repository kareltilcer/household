package db

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"regexp"
	"strconv"
	"testing/fstest"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// Block is one numbered block of migrations: the platform's, or one module's (PRD 01 §9).
// The registry (item 3) assembles the module blocks; this package applies them.
//
// A block's number is two digits, and its migrations are numbered within it: block 1's
// run 01001, 01002, …, block 12's run 12001, …. One goose sequence holds every block,
// so a version identifies its block, and a block can grow without renumbering another.
// Numbers are forever: they are recorded in every database that ran them.
type Block struct {
	Name   string
	Number int
	// FS holds the block's migrations at its root, and nothing else.
	FS fs.FS
}

// migrationName is a migration's file name: its block, its sequence within the block, a
// snake_case description.
var migrationName = regexp.MustCompile(`^(\d{2})(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$`)

// Assemble checks blocks and merges them into the single directory goose reads. It fails
// on a block number outside 1–99 or used twice, a file that is not a migration of its own
// block, and a migration that is not forward-only.
func Assemble(blocks ...Block) (fs.FS, error) {
	merged := fstest.MapFS{}
	names := map[string]bool{}
	numbers := map[int]string{}
	for _, b := range blocks {
		if b.Name == "" || names[b.Name] {
			return nil, fmt.Errorf("migrations: block name %q is empty or used twice", b.Name)
		}
		names[b.Name] = true
		if b.Number < 1 || b.Number > 99 {
			return nil, fmt.Errorf("migrations: block %s has number %d, outside 1–99", b.Name, b.Number)
		}
		if other, dup := numbers[b.Number]; dup {
			return nil, fmt.Errorf("migrations: blocks %s and %s share number %d", other, b.Name, b.Number)
		}
		numbers[b.Number] = b.Name

		entries, err := fs.ReadDir(b.FS, ".")
		if err != nil {
			return nil, fmt.Errorf("migrations: read block %s: %w", b.Name, err)
		}
		for _, e := range entries {
			m := migrationName.FindStringSubmatch(e.Name())
			if e.IsDir() || m == nil {
				return nil, fmt.Errorf("migrations: block %s holds %s, which is not named NNSSS_description.sql", b.Name, e.Name())
			}
			if block, _ := strconv.Atoi(m[1]); block != b.Number {
				return nil, fmt.Errorf("migrations: %s is in block %s (%02d) but numbered for block %02d", e.Name(), b.Name, b.Number, block)
			}
			if m[2] == "000" {
				return nil, fmt.Errorf("migrations: %s: sequences start at 001", e.Name())
			}
			data, err := fs.ReadFile(b.FS, e.Name())
			if err != nil {
				return nil, fmt.Errorf("migrations: read %s: %w", e.Name(), err)
			}
			if err := forwardOnly(data); err != nil {
				return nil, fmt.Errorf("migrations: %s: %w", e.Name(), err)
			}
			merged[e.Name()] = &fstest.MapFile{Data: data}
		}
	}
	return merged, nil
}

// forwardOnly checks a migration has an Up section and no Down section. Migrations are
// forward-only and expand/contract (D-11): a release is undone by a later release, since
// a down migration that drops what a newer app still reads is the outage it would undo.
func forwardOnly(sql []byte) error {
	up := false
	scanner := bufio.NewScanner(bytes.NewReader(sql))
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		switch {
		case bytes.HasPrefix(line, []byte("-- +goose Up")):
			up = true
		case bytes.HasPrefix(line, []byte("-- +goose Down")):
			return fmt.Errorf("has a Down section; migrations are forward-only")
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if !up {
		return fmt.Errorf("has no -- +goose Up annotation")
	}
	return nil
}

// Migrate applies every pending migration in blocks to db, connected as RoleMigrate. It
// takes a session advisory lock, so two instances deploying at once apply each migration
// once. Out-of-order application is allowed: a migration added to an earlier block after a
// later block's newer one has run is a new migration, not a gap (blocks own disjoint
// tables, so their relative order carries no meaning).
func Migrate(ctx context.Context, db *sql.DB, blocks ...Block) ([]*goose.MigrationResult, error) {
	fsys, err := Assemble(blocks...)
	if err != nil {
		return nil, err
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return nil, fmt.Errorf("migrations: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, fsys,
		goose.WithDisableGlobalRegistry(true),
		goose.WithAllowOutofOrder(true),
		goose.WithSessionLocker(locker),
	)
	if err != nil {
		return nil, fmt.Errorf("migrations: %w", err)
	}
	results, err := provider.Up(ctx)
	if err != nil {
		return results, fmt.Errorf("migrations: %w", err)
	}
	return results, nil
}
