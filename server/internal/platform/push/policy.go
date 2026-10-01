package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// admits returns why e's merge policy refuses op, nil when it admits it (PRD 03 §2.5): an additive
// row is only created, since a correction is an online edit under If-Match and never queued; and a
// state_set write carries the state it wants, so there is no delete of one, only the other state.
func admits(e sync.Entity, op Op) *Refusal {
	switch {
	case op != Create && op != Update && op != Delete && op != Action:
		return Refuse(problem.CodeValidationFailed, "op %q is not create, update, delete or action", op)
	case e.Policy == sync.Additive && op != Create:
		return Refuse(problem.CodeValidationFailed,
			"%s is additive: a row is created offline, and corrected online under If-Match", e.Name)
	case e.Policy == sync.StateSet && op == Delete:
		return Refuse(problem.CodeValidationFailed,
			"%s is a state_set: a write carries the state it wants, and none deletes it", e.Name)
	}
	return nil
}

// invariantLock is the namespace of the locks that serialise the creates of one series, the first
// key of the two-key advisory lock whose second is the series' hash.
const invariantLock = db.InvariantLock

// checkInvariant refuses m, an additive create of e, when it breaks the cross-row invariant e
// declares (PRD 03 §2.5, D-24): a non_decreasing series whose value would fall below the row before
// it in the series' order, or rise above the one after it, with monotonicity_violation, naming the
// neighbour it breaks against by its id, its series, its place in the order and its value. Only the
// server can decide it, since a replica may not hold that neighbour (scenario 17). The creates of
// one series are serialised by an advisory lock held until tx ends, so that two arriving at once
// cannot each pass against the rows the other has not written; the lock is keyed on the household,
// whose series no other household's creates can break, and on the series' values as their columns
// hold them, so that two spellings of one value, a meter's id in upper case and in lower, take the
// same lock. A soft-deleted row is no neighbour, nor is one at the same place in the order, nor one
// without a value to compare. A place may so hold several rows, whatever their values: the neighbour
// at the nearest place before the new row is then the greatest there, and after it the least, the
// one it breaks against if any does.
func checkInvariant(ctx context.Context, tx pgx.Tx, e sync.Entity, m Mutation) error {
	inv := e.Invariant
	if inv == nil || e.Policy != sync.Additive || m.Op != Create {
		return nil
	}
	names := append(append([]string{}, inv.Series...), inv.Order, inv.Field)
	values := make(map[string]string, len(names))
	for _, name := range names {
		text, ok := scalar(m.Fields[name])
		if !ok {
			return Refuse(problem.CodeValidationFailed, "a create of %s names its %s", e.Name, name)
		}
		values[name] = text
	}
	types, err := columnTypes(ctx, tx, e.Table, names)
	if err != nil {
		return err
	}
	// A value its column's type cannot read fails the cast here, and is refused as the database
	// refuses it (FromDatabase).
	household := tenant.From(ctx).HouseholdID()
	lockArgs, series := []any{invariantLock, household.String(), e.Table}, []string{"$2::text", "$3::text"}
	for _, s := range inv.Series {
		lockArgs = append(lockArgs, values[s])
		series = append(series, "$"+strconv.Itoa(len(lockArgs))+"::"+types[s]+"::text")
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1, hashtext(concat_ws(E'\\x1f', "+strings.Join(series, ", ")+")))",
		lockArgs...); err != nil {
		return fmt.Errorf("push: lock the series: %w", err)
	}

	args := []any{household}
	param := func(name string) string {
		args = append(args, values[name])
		return "$" + strconv.Itoa(len(args)) + "::" + types[name]
	}
	order, field := pgx.Identifier{inv.Order}.Sanitize(), pgx.Identifier{inv.Field}.Sanitize()
	conditions := []string{"household_id = $1", "deleted_at IS NULL", field + " IS NOT NULL"}
	named := []string{"'id', id"}
	for _, s := range inv.Series {
		conditions = append(conditions, pgx.Identifier{s}.Sanitize()+" = "+param(s))
	}
	for _, n := range names {
		named = append(named, literal(n)+", "+pgx.Identifier{n}.Sanitize())
	}
	at, value := param(inv.Order), param(inv.Field)
	// The nearest row on each side of the new one: before it, one whose value is greater breaks the
	// series; after it, one whose value is less. Of several rows at the nearest place, the one
	// furthest that way is read, ordered by its value as by its place: another at that place, read
	// by chance, could pass where it breaks.
	for _, side := range []struct{ where, direction, breaks, says string }{
		{"<", "DESC", ">", "falls below that of %s, the row before it"},
		{">", "ASC", "<", "rises above that of %s, the row after it"},
	} {
		var (
			nearest map[string]any
			broken  bool
		)
		err := tx.QueryRow(ctx, fmt.Sprintf(`
			SELECT jsonb_build_object(%s), %s %s %s
			FROM %s WHERE %s AND %s %s %s
			ORDER BY %s %s, %s %s LIMIT 1`,
			strings.Join(named, ", "), field, side.breaks, value,
			pgx.Identifier{e.Table}.Sanitize(), strings.Join(conditions, " AND "), order, side.where, at,
			order, side.direction, field, side.direction), args...).Scan(&nearest, &broken)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			continue
		case err != nil:
			return fmt.Errorf("push: read the series of %s: %w", e.Name, err)
		case broken:
			return &Refusal{
				Code:    problem.CodeMonotonicityViolation,
				Message: fmt.Sprintf("its %s "+side.says, inv.Field, fmt.Sprint(nearest["id"])),
				Row:     nearest,
			}
		}
	}
	return nil
}

// scalar returns raw, a JSON scalar, as the text PostgreSQL reads a value of its column's type
// from: a string's contents, or a number's or a boolean's literal; false for anything else, and
// for a string holding U+0000, which no text PostgreSQL holds can.
func scalar(raw json.RawMessage) (string, bool) {
	var v any
	if len(raw) == 0 || json.Unmarshal(raw, &v) != nil {
		return "", false
	}
	switch v := v.(type) {
	case string:
		return v, !strings.ContainsRune(v, 0)
	case float64, bool:
		return strings.TrimSpace(string(raw)), true
	}
	return "", false
}

// literal returns s as an SQL string literal.
func literal(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// columnTypes returns the type of each of columns of table, as PostgreSQL names it for a cast, and
// fails naming a column the table does not have: a declaration that is wrong, not a refusal.
func columnTypes(ctx context.Context, tx pgx.Tx, table string, columns []string) (map[string]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT a.attname::text, format_type(a.atttypid, a.atttypmod)
		FROM pg_attribute a
		WHERE a.attrelid = to_regclass($1) AND a.attname = ANY($2) AND a.attnum > 0 AND NOT a.attisdropped`,
		table, columns)
	if err != nil {
		return nil, fmt.Errorf("push: read the columns of %s: %w", table, err)
	}
	out := map[string]string{}
	var name, kind string
	if _, err := pgx.ForEachRow(rows, []any{&name, &kind}, func() error {
		out[name] = kind
		return nil
	}); err != nil {
		return nil, fmt.Errorf("push: read the columns of %s: %w", table, err)
	}
	for _, c := range columns {
		if _, ok := out[c]; !ok {
			return nil, fmt.Errorf("push: %s has no column %s, which its invariant names", table, c)
		}
	}
	return out, nil
}
