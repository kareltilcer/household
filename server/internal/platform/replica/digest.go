package replica

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zeebo/xxh3"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Algorithm is the hash a replica's report is computed with, which it names (ReplicaDigest's
// algorithm): each row's pair hashes as the xxh3-64 of "<entity_id>:<version>", and an entity type's
// hash is the sum of its rows', modulo 2^64, so that it is the same in whatever order they are added
// (D-125). packages/test-vectors/vectors/replica-digest.json holds both halves to it.
const Algorithm = "xxh3-64"

// PairHash is the hash of one row's pair: the xxh3-64 of its id, in its canonical lowercase form, a
// colon, and its version in decimal.
func PairHash(id uuid.UUID, version int64) uint64 {
	return xxh3.HashString(id.String() + ":" + strconv.FormatInt(version, 10))
}

// Digest is an entity type's rows, as a replica holds them or as the server finds the caller may see
// them: how many, and the sum of their pairs' hashes.
type Digest struct {
	Count int64
	Hash  uint64
}

// Add adds a row to d.
func (d *Digest) Add(id uuid.UUID, version int64) {
	d.Count++
	d.Hash += PairHash(id, version)
}

// Hex is d's hash as a report carries it: sixteen lowercase hexadecimal digits.
func (d Digest) Hex() string {
	return fmt.Sprintf("%016x", d.Hash)
}

// Expected returns, for each of entities, the digest of its rows the caller of scope may see as the
// streams generated from it send them (sync.Streams), read in tx, a transaction of scope's household:
//
//   - Members: every row of the household.
//   - Grant: every row, while the caller's level on the entity's module is above none; none
//     otherwise, which is the grant's two streams, an owner of the household while it enables the
//     module, and a member granted it while it does.
//   - Owner: the shared rows and the caller's own private ones; and every private row when the
//     entity has a redacted projection, whose rows a replica holds in the projection's own table,
//     since an entity's rows are counted once each, by id, whichever of its tables holds them.
//   - Audience: of those, the rows whose readers name the caller.
//
// A soft-deleted row stays in its streams, a tombstone, and is counted. A suspended household reaches
// no stream, and no request of its either, which the tenant middleware refuses.
func Expected(ctx context.Context, tx pgx.Tx, scope *tenant.Scope, entities []sync.Entity) (map[string]Digest, error) {
	out := make(map[string]Digest, len(entities))
	for _, e := range entities {
		if e.Access&sync.Members == 0 && scope.Level(e.Module()) == access.None {
			out[e.Name] = Digest{}
			continue
		}
		key := "household_id"
		if e.Table == sync.TenantRoot {
			key = "id"
		}
		query := "SELECT id, version FROM " + e.Identifier() + " WHERE " + key + " = $1"
		args := []any{scope.HouseholdID()}
		if e.Access&sync.Owner != 0 {
			if e.Redacted != nil {
				query += " AND " + sync.VisibilityColumn + " IN ('shared', 'private')"
			} else {
				args = append(args, scope.UserID())
				query += fmt.Sprintf(" AND (%s = 'shared' OR (%s = 'private' AND %s = $%d))",
					sync.VisibilityColumn, sync.VisibilityColumn, sync.OwnerColumn, len(args))
			}
		}
		if e.Access&sync.Audience != 0 {
			args = append(args, scope.UserID())
			query += fmt.Sprintf(" AND $%d = ANY (%s)", len(args), sync.ReadersColumn)
		}
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return nil, fmt.Errorf("replica: read %s's rows: %w", e.Name, err)
		}
		var (
			d       Digest
			id      uuid.UUID
			version int64
		)
		if _, err := pgx.ForEachRow(rows, []any{&id, &version}, func() error {
			d.Add(id, version)
			return nil
		}); err != nil {
			return nil, fmt.Errorf("replica: read %s's rows: %w", e.Name, err)
		}
		out[e.Name] = d
	}
	return out, nil
}
