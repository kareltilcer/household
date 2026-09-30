package conformance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// ClockClamp is how far a client_time may be from the server's before it is clamped and flagged
// (PRD 03 §2.8, D-26).
const ClockClamp = 24 * time.Hour

// The outcomes of a pushed mutation (PRD 03 §2.4). The stand-in answers three of them; merged and
// conflict are item 13's and item 14's.
const (
	Applied  = "applied"
	Rejected = "rejected"
	Deferred = "deferred"
)

// DependencyFailed is the code of a deferred mutation: an earlier one of its batch, to the entity
// it writes or to the item it names, was not applied (PRD 03 §2.4, FR-SY6).
const DependencyFailed = "dependency_failed"

// MutationIn is one mutation of a pushed batch, the contract's SyncMutation.
type MutationIn struct {
	MutationID  uuid.UUID                  `json:"mutation_id"`
	EntityType  string                     `json:"entity_type"`
	EntityID    uuid.UUID                  `json:"entity_id"`
	Op          string                     `json:"op"`
	BaseVersion *int64                     `json:"base_version"`
	Action      *string                    `json:"action"`
	Fields      map[string]json.RawMessage `json:"fields"`
	ClientTime  *time.Time                 `json:"client_time"`
}

type batchIn struct {
	Mutations []MutationIn `json:"mutations"`
}

// Result is the answer to one mutation, the contract's SyncMutationResult.
type Result struct {
	MutationID uuid.UUID `json:"mutation_id"`
	Outcome    string    `json:"outcome"`
	Version    *int64    `json:"version"`
	Row        any       `json:"row,omitempty"`
	Code       *string   `json:"code"`
	Message    *string   `json:"message"`
}

// BatchResult is the answer to a batch, the contract's SyncMutationBatchResult.
type BatchResult struct {
	Results []Result `json:"results"`
	Seq     int64    `json:"seq"`
}

// ItemRow is a conformance item as the push answers it.
type ItemRow struct {
	ID          uuid.UUID  `json:"id"`
	HouseholdID uuid.UUID  `json:"household_id"`
	Title       string     `json:"title"`
	Note        string     `json:"note"`
	Quantity    int        `json:"quantity"`
	Version     int64      `json:"version"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

const itemColumns = "id, household_id, title, note, quantity, version, deleted_at"

func scanItem(row pgx.Row) (ItemRow, error) {
	var it ItemRow
	err := row.Scan(&it.ID, &it.HouseholdID, &it.Title, &it.Note, &it.Quantity, &it.Version, &it.DeletedAt)
	return it, err
}

// CheckRow is an item's checked state as the push answers it.
type CheckRow struct {
	ID           uuid.UUID `json:"id"`
	HouseholdID  uuid.UUID `json:"household_id"`
	ItemID       uuid.UUID `json:"item_id"`
	Checked      bool      `json:"checked"`
	CheckedAt    time.Time `json:"checked_at"`
	ClockFlagged bool      `json:"clock_flagged"`
	Version      int64     `json:"version"`
}

const checkColumns = "id, household_id, item_id, checked, checked_at, clock_flagged, version"

func scanCheck(row pgx.Row) (CheckRow, error) {
	var c CheckRow
	err := row.Scan(&c.ID, &c.HouseholdID, &c.ItemID, &c.Checked, &c.CheckedAt, &c.ClockFlagged, &c.Version)
	return c, err
}

// refusal is a mutation the push rejects, with the code and the message its result carries.
type refusal struct {
	code    problem.Code
	message string
}

func (r *refusal) Error() string { return string(r.code) + ": " + r.message }

func refuse(code problem.Code, format string, args ...any) *refusal {
	return &refusal{code: code, message: fmt.Sprintf(format, args...)}
}

// push applies a batch in order, each mutation in its own transaction through the mutation spine,
// and answers every one (FR-SY6): a mutation that fails does not stop the ones after it, and one
// that names an entity an earlier mutation of the batch failed to write, or whose item_id does, is
// deferred. It writes conformance.item, lww_field by server receipt, whose soft delete is a field
// like the others (PRD modules/05 Sync, B), and conformance.item_checked, state_set on its
// item_id resolved by the latest client time. Any other entity is rejected: its merge is item 13's
// or item 14's. The stand-in keeps no per-mutation idempotency (FR-SY5, item 13): the batch's
// Idempotency-Key answers a batch sent again whole.
func (s *StandIn) push(w http.ResponseWriter, r *http.Request) {
	ctx := mutation.WithVia(r.Context(), audit.ViaSync)
	requestID := reqctx.RequestID(ctx)
	var batch batchIn
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	now := s.cfg.Now()
	failed := map[uuid.UUID]bool{}
	out := BatchResult{Results: make([]Result, 0, len(batch.Mutations))}
	for _, m := range batch.Mutations {
		res, seq, err := s.apply(ctx, m, now, failed)
		if err != nil {
			s.cfg.Logger.LogAttrs(ctx, slog.LevelError, "the stand-in's push failed", slog.Any("error", err))
			problem.Write(w, requestID, problem.Internal())
			return
		}
		if res.Outcome != Applied {
			failed[m.EntityID] = true
		}
		out.Seq = max(out.Seq, seq)
		out.Results = append(out.Results, res)
	}
	if out.Seq == 0 {
		err := tenant.InTx(ctx, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, "SELECT coalesce(max(seq), 0) FROM sync_changes WHERE household_id = $1",
				tenant.From(ctx).HouseholdID()).Scan(&out.Seq)
		})
		if err != nil {
			s.cfg.Logger.LogAttrs(ctx, slog.LevelError, "the stand-in's push failed", slog.Any("error", err))
			problem.Write(w, requestID, problem.Internal())
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// apply answers one mutation, and returns the feed seq it wrote, zero for none. An error is one
// the push cannot answer the mutation for.
func (s *StandIn) apply(ctx context.Context, m MutationIn, now time.Time, failed map[uuid.UUID]bool) (Result, int64, error) {
	res := Result{MutationID: m.MutationID}
	if err := grant.Require(ctx, Name, access.Contribute); err != nil {
		var p *problem.Problem
		if !errors.As(err, &p) {
			return res, 0, err
		}
		return reject(res, &refusal{code: p.Code, message: "the caller may not write this module"}), 0, nil
	}
	if item := fieldUUID(m.Fields, "item_id"); failed[m.EntityID] || (item != uuid.Nil && failed[item]) {
		res.Outcome = Deferred
		res.Code = ptr(DependencyFailed)
		res.Message = ptr("an earlier mutation of this batch to what this one depends on was not applied")
		return res, 0, nil
	}
	clientTime, flagged := clamp(m.ClientTime, now)

	var (
		row     any
		version int64
	)
	applied, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		var (
			rec mutation.Record
			err error
		)
		switch m.EntityType {
		case Item:
			rec, row, version, err = writeItem(ctx, tx, m)
		case ItemChecked:
			rec, row, version, err = writeCheck(ctx, tx, m, clientTime, flagged)
		default:
			err = refuse(problem.CodeValidationFailed,
				"the stand-in's push writes %s and %s; items 13 and 14 build the push for %s", Item, ItemChecked, m.EntityType)
		}
		return rec, err
	})
	var no *refusal
	switch {
	case errors.As(err, &no):
		return reject(res, no), 0, nil
	case err != nil:
		if refused := fromDatabase(err); refused != nil {
			return reject(res, refused), 0, nil
		}
		return res, 0, err
	}
	res.Outcome, res.Version, res.Row = Applied, &version, row
	return res, applied.Seq, nil
}

func reject(res Result, no *refusal) Result {
	res.Outcome = Rejected
	res.Code = ptr(string(no.code))
	res.Message = ptr(no.message)
	return res
}

func ptr[T any](v T) *T { return &v }

// fromDatabase returns the refusal a constraint the database enforces stands for: a value out of
// range, or a reference to a row that is not the household's.
func fromDatabase(err error) *refusal {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return nil
	}
	switch pgErr.Code {
	case "23514", "23502", "22P02", "22003":
		return refuse(problem.CodeValidationFailed, "a field is out of range: %s", pgErr.ConstraintName)
	case "23503":
		return refuse(problem.CodeNotFound, "it names a row that is not there")
	case "23505":
		return refuse(problem.CodeValidationFailed, "its id is taken")
	}
	return nil
}

// clamp returns t held to ClockClamp of now, and whether it had to be; a mutation without a
// client time is taken as made now.
func clamp(t *time.Time, now time.Time) (time.Time, bool) {
	if t == nil {
		return now, false
	}
	switch {
	case t.Before(now.Add(-ClockClamp)):
		return now.Add(-ClockClamp), true
	case t.After(now.Add(ClockClamp)):
		return now.Add(ClockClamp), true
	}
	return *t, false
}

// fieldUUID returns fields[name] as a UUID, or the nil UUID.
func fieldUUID(fields map[string]json.RawMessage, name string) uuid.UUID {
	var id uuid.UUID
	if raw, ok := fields[name]; ok {
		_ = json.Unmarshal(raw, &id)
	}
	return id
}

// itemFields are the fields of an item a mutation may set.
type itemFields struct {
	Title    *string `json:"title"`
	Note     *string `json:"note"`
	Quantity *int    `json:"quantity"`
}

func decodeFields(fields map[string]json.RawMessage, allowed []string, into any) error {
	for name := range fields {
		found := false
		for _, a := range allowed {
			found = found || a == name
		}
		if !found {
			return refuse(problem.CodeValidationFailed, "%s is not a field this entity takes", name)
		}
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return refuse(problem.CodeValidationFailed, "a field has the wrong type: %v", err)
	}
	return nil
}

func (f itemFields) validate() error {
	switch {
	case f.Title != nil && (*f.Title == "" || utf8.RuneCountInString(*f.Title) > 200):
		return refuse(problem.CodeValidationFailed, "title is 1 to 200 characters")
	case f.Note != nil && utf8.RuneCountInString(*f.Note) > 2000:
		return refuse(problem.CodeValidationFailed, "note is at most 2000 characters")
	case f.Quantity != nil && (*f.Quantity < 1 || *f.Quantity > 999):
		return refuse(problem.CodeValidationFailed, "quantity is 1 to 999")
	}
	return nil
}

// writeItem writes an item's create, update or delete. A create delivered again finds its row and
// writes nothing. An update sets the fields it names, the others left as they are, whatever wrote
// them in between, and lands on a deleted item as it would on a live one; one that changes nothing
// writes nothing. A delete sets deleted_at, and one of a deleted item writes nothing.
func writeItem(ctx context.Context, tx pgx.Tx, m MutationIn) (mutation.Record, any, int64, error) {
	var f itemFields
	if err := decodeFields(m.Fields, []string{"title", "note", "quantity"}, &f); err != nil {
		return mutation.Record{}, nil, 0, err
	}
	if err := f.validate(); err != nil {
		return mutation.Record{}, nil, 0, err
	}
	household := tenant.From(ctx).HouseholdID()
	var (
		it     ItemRow
		err    error
		action string
	)
	switch m.Op {
	case "create":
		if f.Title == nil {
			return mutation.Record{}, nil, 0, refuse(problem.CodeValidationFailed, "a create names its title")
		}
		action = "item.create"
		it, err = scanItem(tx.QueryRow(ctx, `
			INSERT INTO conformance_items (id, household_id, title, note, quantity)
			VALUES ($1, $2, $3, coalesce($4, ''), coalesce($5, 1))
			ON CONFLICT (id) DO NOTHING
			RETURNING `+itemColumns, m.EntityID, household, *f.Title, f.Note, f.Quantity))
	case "update":
		action = "item.update"
		sets, args := []string{}, []any{m.EntityID}
		for _, v := range []struct {
			column string
			value  any
			set    bool
		}{
			{"title", f.Title, f.Title != nil},
			{"note", f.Note, f.Note != nil},
			{"quantity", f.Quantity, f.Quantity != nil},
		} {
			if v.set {
				args = append(args, v.value)
				sets = append(sets, fmt.Sprintf("%s = $%d", v.column, len(args)))
			}
		}
		if len(sets) == 0 {
			err = pgx.ErrNoRows
			break
		}
		changed := make([]string, len(sets))
		for i, set := range sets {
			changed[i] = strings.Replace(set, " = ", " IS DISTINCT FROM ", 1)
		}
		it, err = scanItem(tx.QueryRow(ctx, `
			UPDATE conformance_items SET `+strings.Join(sets, ", ")+`
			WHERE id = $1 AND (`+strings.Join(changed, " OR ")+`)
			RETURNING `+itemColumns, args...))
	case "delete":
		action = "item.delete"
		it, err = scanItem(tx.QueryRow(ctx, `
			UPDATE conformance_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL
			RETURNING `+itemColumns, m.EntityID))
	default:
		return mutation.Record{}, nil, 0, refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Item)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing written: the state is already in place, or the item is not there to write.
		current, err := scanItem(tx.QueryRow(ctx, "SELECT "+itemColumns+" FROM conformance_items WHERE id = $1", m.EntityID))
		switch {
		case errors.Is(err, pgx.ErrNoRows) && m.Op == "create":
			return mutation.Record{}, nil, 0, refuse(problem.CodeValidationFailed, "its id is taken")
		case errors.Is(err, pgx.ErrNoRows):
			return mutation.Record{}, nil, 0, refuse(problem.CodeNotFound, "the item is not there")
		case err != nil:
			return mutation.Record{}, nil, 0, err
		}
		return mutation.Record{}, current, current.Version, nil
	}
	if err != nil {
		return mutation.Record{}, nil, 0, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: action, EntityType: Item, EntityID: it.ID,
			SummaryKey: "conformance." + action, SummaryArgs: map[string]any{"title": it.Title},
		},
		Changes: []sync.Change{{Entity: Item, ID: it.ID, Op: sync.Upsert, Version: it.Version, Row: it}},
	}, it, it.Version, nil
}

// checkFields are the fields of an item's checked state.
type checkFields struct {
	ItemID  *uuid.UUID `json:"item_id"`
	Checked *bool      `json:"checked"`
}

// writeCheck writes the state a check or an uncheck wants, keyed on its item_id: the first write
// for an item makes its row, under the id the mutation names, and every later one, under whatever
// id, is resolved against that row by client time, an older intent losing to the one in place and
// a state already in place writing nothing (PRD 03 §2.5).
func writeCheck(ctx context.Context, tx pgx.Tx, m MutationIn, clientTime time.Time, flagged bool) (mutation.Record, any, int64, error) {
	if m.Op != "create" && m.Op != "update" {
		return mutation.Record{}, nil, 0, refuse(problem.CodeValidationFailed, "%s takes create and update", ItemChecked)
	}
	var f checkFields
	if err := decodeFields(m.Fields, []string{"item_id", "checked", "checked_at"}, &f); err != nil {
		return mutation.Record{}, nil, 0, err
	}
	if f.ItemID == nil || f.Checked == nil {
		return mutation.Record{}, nil, 0, refuse(problem.CodeValidationFailed, "a check names its item_id and its checked state")
	}
	household := tenant.From(ctx).HouseholdID()
	c, err := scanCheck(tx.QueryRow(ctx, `
		INSERT INTO conformance_item_checks AS c (id, household_id, item_id, checked, checked_at, clock_flagged)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (household_id, item_id) DO UPDATE
		  SET checked = excluded.checked, checked_at = excluded.checked_at, clock_flagged = excluded.clock_flagged
		  WHERE c.checked_at <= excluded.checked_at AND c.checked IS DISTINCT FROM excluded.checked
		RETURNING `+checkColumns, m.EntityID, household, *f.ItemID, *f.Checked, clientTime, flagged))
	if errors.Is(err, pgx.ErrNoRows) {
		current, err := scanCheck(tx.QueryRow(ctx,
			"SELECT "+checkColumns+" FROM conformance_item_checks WHERE household_id = $1 AND item_id = $2", household, *f.ItemID))
		if err != nil {
			return mutation.Record{}, nil, 0, err
		}
		return mutation.Record{}, current, current.Version, nil
	}
	if err != nil {
		return mutation.Record{}, nil, 0, err
	}
	return mutation.Record{
		Event: audit.Event{
			Module: Name, Action: "item_checked.set", EntityType: ItemChecked, EntityID: c.ID,
			SummaryKey: "conformance.item_checked.set", SummaryArgs: map[string]any{"checked": c.Checked},
		},
		Changes: []sync.Change{{Entity: ItemChecked, ID: c.ID, Op: sync.Upsert, Version: c.Version, Row: c}},
	}, c, c.Version, nil
}
