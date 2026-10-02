package conformance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// WriteSync writes m, a mutation the push has checked against its entity's declaration, the
// caller's grant and any invariant: an item's fields, lww_field by server receipt, its soft delete a
// field like the others (PRD modules/05 Sync, B); an item's checked state and a chore's completion,
// state_set on their keys resolved by the latest client time; a meter's reading, additive; a budget,
// a chore and a conversation, strict_version; a note, lww_row with its loser preserved, and its
// comments; an attachment's row; and a conversation's members and messages, its audience.
func (Module) WriteSync(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	write, ok := map[string]func(context.Context, pgx.Tx, push.Mutation) (push.Written, error){
		Item: writeItem, ItemChecked: writeCheck, Reading: writeReading, Completion: writeCompletion,
		Budget: writeBudget, Note: writeNote, NoteComment: writeComment, Chore: writeChore, Attachment: writeAttachment,
		Conversation: writeConversation, ConversationMember: writeMember, Message: writeMessage,
	}[m.Entity.Name]
	if !ok {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s is not one of the module's entities", m.Entity.Name)
	}
	return write(ctx, tx, m)
}

// written is what a write that recorded ev and changed row came to.
func written(ev audit.Event, entity string, id uuid.UUID, version int64, row any) push.Written {
	return push.Written{
		Record: mutation.Record{
			Event:   ev,
			Changes: []sync.Change{{Entity: entity, ID: id, Op: sync.Upsert, Version: version, Row: row}},
		},
		Row: row, Version: version,
	}
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

// itemFields are the fields of an item a mutation may set.
type itemFields struct {
	Title    *string `json:"title"`
	Note     *string `json:"note"`
	Quantity *int    `json:"quantity"`
}

func (f itemFields) validate() error {
	switch {
	case f.Title != nil && (*f.Title == "" || utf8.RuneCountInString(*f.Title) > 200):
		return push.Refuse(problem.CodeValidationFailed, "title is 1 to 200 characters")
	case f.Note != nil && utf8.RuneCountInString(*f.Note) > 2000:
		return push.Refuse(problem.CodeValidationFailed, "note is at most 2000 characters")
	case f.Quantity != nil && (*f.Quantity < 1 || *f.Quantity > 999):
		return push.Refuse(problem.CodeValidationFailed, "quantity is 1 to 999")
	}
	return nil
}

// writeItem writes an item's create, update or delete. A create of an id the household already
// holds finds its row and writes nothing. An update sets the fields it names, the others left as
// they are, whatever wrote them in between, and lands on a deleted item as it would on a live one;
// one that changes nothing writes nothing. Its audit event keeps each field it changed, as it was and
// as it became, so that a value another member's later write replaced is never dropped unseen
// (scenario 2): the activity log shows it, and the later write is answered merged (D-122). A delete
// sets deleted_at, and one of a deleted item writes nothing.
func writeItem(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f itemFields
	if err := push.Decode(m.Fields, []string{"title", "note", "quantity"}, &f); err != nil {
		return push.Written{}, err
	}
	if err := f.validate(); err != nil {
		return push.Written{}, err
	}
	household := tenant.From(ctx).HouseholdID()
	var (
		it     ItemRow
		before ItemRow
		err    error
		action string
	)
	//nolint:exhaustive // An item takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if f.Title == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a create names its title")
		}
		action = "item.create"
		it, err = scanItem(tx.QueryRow(ctx, `
			INSERT INTO conformance_items (id, household_id, title, note, quantity)
			VALUES ($1, $2, $3, coalesce($4, ''), coalesce($5, 1))
			ON CONFLICT (id) DO NOTHING
			RETURNING `+itemColumns, m.EntityID, household, *f.Title, f.Note, f.Quantity))
	case push.Update:
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
		// The push holds the row locked: it stands as read here until the update.
		if before, err = scanItem(tx.QueryRow(ctx, "SELECT "+itemColumns+" FROM conformance_items WHERE id = $1", m.EntityID)); err != nil {
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
	case push.Delete:
		action = "item.delete"
		it, err = scanItem(tx.QueryRow(ctx, `
			UPDATE conformance_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL
			RETURNING `+itemColumns, m.EntityID))
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Item)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing written: the state is already in place, or the item is not there to write.
		current, err := scanItem(tx.QueryRow(ctx, "SELECT "+itemColumns+" FROM conformance_items WHERE id = $1", m.EntityID))
		switch {
		case errors.Is(err, pgx.ErrNoRows) && m.Op == push.Create:
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "its id is another row's")
		case errors.Is(err, pgx.ErrNoRows):
			return push.Written{}, push.Refuse(problem.CodeNotFound, "the item is not there")
		case err != nil:
			return push.Written{}, err
		}
		return push.Written{Row: current, Version: current.Version}, nil
	}
	if err != nil {
		return push.Written{}, err
	}
	ev := audit.Event{
		Module: Name, Action: action, EntityType: Item, EntityID: it.ID,
		SummaryKey: Name + "." + action, SummaryArgs: map[string]any{"title": it.Title},
	}
	if m.Op == push.Update {
		for _, d := range []struct {
			field     string
			old, new  any
			different bool
		}{
			{"title", before.Title, it.Title, before.Title != it.Title},
			{"note", before.Note, it.Note, before.Note != it.Note},
			{"quantity", before.Quantity, it.Quantity, before.Quantity != it.Quantity},
		} {
			if d.different {
				ev.Changes = append(ev.Changes, audit.Change{Field: d.field, Old: d.old, New: d.new})
			}
		}
	}
	return written(ev, Item, it.ID, it.Version, it), nil
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

// checkFields are the fields of an item's checked state.
type checkFields struct {
	ItemID  *uuid.UUID `json:"item_id"`
	Checked *bool      `json:"checked"`
}

// writeCheck writes the state a check or an uncheck wants, keyed on its item_id: the first write for
// an item makes its row, under the id the mutation names, and every later one, under whatever id, is
// resolved against that row by client time, an older intent losing to the one in place and a state
// already in place writing nothing (PRD 03 §2.5). The row keeps the client time of the intent in
// place, held to a day of the server's, and whether it had to be held.
func writeCheck(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	if m.Op != push.Create && m.Op != push.Update {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create and update", ItemChecked)
	}
	var f checkFields
	if err := push.Decode(m.Fields, []string{"item_id", "checked", "checked_at"}, &f); err != nil {
		return push.Written{}, err
	}
	if f.ItemID == nil || f.Checked == nil {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a check names its item_id and its checked state")
	}
	household := tenant.From(ctx).HouseholdID()
	c, err := scanCheck(tx.QueryRow(ctx, `
		INSERT INTO conformance_item_checks AS c (id, household_id, item_id, checked, checked_at, clock_flagged)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (household_id, item_id) DO UPDATE
		  SET checked = excluded.checked, checked_at = excluded.checked_at, clock_flagged = excluded.clock_flagged
		  WHERE c.checked_at <= excluded.checked_at AND c.checked IS DISTINCT FROM excluded.checked
		RETURNING `+checkColumns, m.EntityID, household, *f.ItemID, *f.Checked, m.ClientTime, m.ClockFlagged))
	if errors.Is(err, pgx.ErrNoRows) {
		current, err := scanCheck(tx.QueryRow(ctx,
			"SELECT "+checkColumns+" FROM conformance_item_checks WHERE household_id = $1 AND item_id = $2", household, *f.ItemID))
		if err != nil {
			return push.Written{}, err
		}
		return push.Written{Row: current, Version: current.Version}, nil
	}
	if err != nil {
		return push.Written{}, err
	}
	return written(audit.Event{
		Module: Name, Action: "item_checked.set", EntityType: ItemChecked, EntityID: c.ID,
		SummaryKey: Name + ".item_checked.set", SummaryArgs: map[string]any{"checked": c.Checked},
	}, ItemChecked, c.ID, c.Version, c), nil
}

// ReadingRow is a meter reading as the push answers it.
type ReadingRow struct {
	ID          uuid.UUID `json:"id"`
	HouseholdID uuid.UUID `json:"household_id"`
	MeterID     uuid.UUID `json:"meter_id"`
	ReadAt      time.Time `json:"read_at"`
	Value       int64     `json:"value"`
	Version     int64     `json:"version"`
}

const readingColumns = "id, household_id, meter_id, read_at, value, version"

func scanReading(row pgx.Row) (ReadingRow, error) {
	var r ReadingRow
	err := row.Scan(&r.ID, &r.HouseholdID, &r.MeterID, &r.ReadAt, &r.Value, &r.Version)
	return r, err
}

// readingFields are the fields of a meter reading.
type readingFields struct {
	MeterID *uuid.UUID `json:"meter_id"`
	ReadAt  *time.Time `json:"read_at"`
	Value   *int64     `json:"value"`
}

// writeReading writes a meter reading, which is only ever created (additive): the push has held it to
// its meter's series (non_decreasing) before it gets here. A create of an id the household holds
// already finds its row and writes nothing.
func writeReading(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f readingFields
	if err := push.Decode(m.Fields, []string{"meter_id", "read_at", "value"}, &f); err != nil {
		return push.Written{}, err
	}
	if f.MeterID == nil || f.ReadAt == nil || f.Value == nil {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a reading names its meter_id, its read_at and its value")
	}
	household := tenant.From(ctx).HouseholdID()
	r, err := scanReading(tx.QueryRow(ctx, `
		INSERT INTO conformance_readings (id, household_id, meter_id, read_at, value) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO NOTHING
		RETURNING `+readingColumns, m.EntityID, household, *f.MeterID, *f.ReadAt, *f.Value))
	if errors.Is(err, pgx.ErrNoRows) {
		current, err := scanReading(tx.QueryRow(ctx, "SELECT "+readingColumns+" FROM conformance_readings WHERE id = $1", m.EntityID))
		if errors.Is(err, pgx.ErrNoRows) {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "its id is another row's")
		}
		if err != nil {
			return push.Written{}, err
		}
		return push.Written{Row: current, Version: current.Version}, nil
	}
	if err != nil {
		return push.Written{}, err
	}
	return written(audit.Event{
		Module: Name, Action: "reading.create", EntityType: Reading, EntityID: r.ID,
		SummaryKey: Name + ".reading.create", SummaryArgs: map[string]any{"value": r.Value},
	}, Reading, r.ID, r.Version, r), nil
}

// CompletionRow is a chore's completion as the push answers it.
type CompletionRow struct {
	ID          uuid.UUID `json:"id"`
	HouseholdID uuid.UUID `json:"household_id"`
	ChoreID     uuid.UUID `json:"chore_id"`
	Occurrence  string    `json:"occurrence"`
	Done        bool      `json:"done"`
	DoneAt      time.Time `json:"done_at"`
	// Rotated says the occurrence advanced its chore's rotation, which it does once (D-52).
	Rotated bool  `json:"rotated"`
	Version int64 `json:"version"`
}

const completionColumns = "id, household_id, chore_id, occurrence::text, done, done_at, rotated, version"

func scanCompletion(row pgx.Row) (CompletionRow, error) {
	var c CompletionRow
	err := row.Scan(&c.ID, &c.HouseholdID, &c.ChoreID, &c.Occurrence, &c.Done, &c.DoneAt, &c.Rotated, &c.Version)
	return c, err
}

// completionFields are the fields of a chore's completion; its occurrence is a calendar day of the
// household's, YYYY-MM-DD.
type completionFields struct {
	ChoreID    *uuid.UUID `json:"chore_id"`
	Occurrence *string    `json:"occurrence"`
	Done       *bool      `json:"done"`
}

// writeCompletion writes the state a completion wants, keyed on its chore and its occurrence (D-52):
// two members completing one occurrence offline make one row, applied once, whatever id each gave
// it, resolved by client time as a check is. The occurrence that first comes to be done advances its
// chore's rotation by one, the server's to advance from the occurrence and never from the mutation
// (D-52): once, however many completions of it arrive, and not again when it is undone and done again,
// which its rotated says.
func writeCompletion(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	if m.Op != push.Create && m.Op != push.Update {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create and update", Completion)
	}
	var f completionFields
	if err := push.Decode(m.Fields, []string{"chore_id", "occurrence", "done"}, &f); err != nil {
		return push.Written{}, err
	}
	if f.ChoreID == nil || f.Occurrence == nil || f.Done == nil {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a completion names its chore_id, its occurrence and its done")
	}
	if _, err := time.Parse(time.DateOnly, *f.Occurrence); err != nil {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "occurrence is a calendar day, YYYY-MM-DD")
	}
	household := tenant.From(ctx).HouseholdID()
	// The chore is locked until the write commits: its completions, and the rotation they advance,
	// are written one at a time, so that two first completions of one occurrence cannot each find it
	// not yet rotated.
	var rotated bool
	err := tx.QueryRow(ctx, `
		SELECT coalesce((SELECT c.rotated FROM conformance_completions c
		                 WHERE c.household_id = $1 AND c.chore_id = h.id AND c.occurrence = $3::date), false)
		FROM conformance_chores h WHERE h.household_id = $1 AND h.id = $2 FOR UPDATE OF h`,
		household, *f.ChoreID, *f.Occurrence).Scan(&rotated)
	if errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, gone("chore")
	}
	if err != nil {
		return push.Written{}, err
	}
	c, err := scanCompletion(tx.QueryRow(ctx, `
		INSERT INTO conformance_completions AS c (id, household_id, chore_id, occurrence, done, done_at, rotated)
		VALUES ($1, $2, $3, $4::date, $5, $6, $5)
		ON CONFLICT (household_id, chore_id, occurrence) DO UPDATE
		  SET done = excluded.done, done_at = excluded.done_at, rotated = c.rotated OR excluded.done
		  WHERE c.done_at <= excluded.done_at AND c.done IS DISTINCT FROM excluded.done
		RETURNING `+completionColumns, m.EntityID, household, *f.ChoreID, *f.Occurrence, *f.Done, m.ClientTime))
	if errors.Is(err, pgx.ErrNoRows) {
		current, err := scanCompletion(tx.QueryRow(ctx, "SELECT "+completionColumns+
			" FROM conformance_completions WHERE household_id = $1 AND chore_id = $2 AND occurrence = $3::date",
			household, *f.ChoreID, *f.Occurrence))
		if err != nil {
			return push.Written{}, err
		}
		return push.Written{Row: current, Version: current.Version}, nil
	}
	if err != nil {
		return push.Written{}, err
	}
	w := written(audit.Event{
		Module: Name, Action: "completion.set", EntityType: Completion, EntityID: c.ID,
		SummaryKey: Name + ".completion.set", SummaryArgs: map[string]any{"done": c.Done},
	}, Completion, c.ID, c.Version, c)
	if c.Rotated && !rotated {
		chore, err := scanChore(tx.QueryRow(ctx, `
			UPDATE conformance_chores SET rotation_index = (rotation_index + 1) % cardinality(rotation)
			WHERE household_id = $1 AND id = $2 AND cardinality(rotation) > 0
			RETURNING `+choreColumns, household, c.ChoreID))
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// A chore that rotates through no one has no rotation to advance.
		case err != nil:
			return push.Written{}, err
		default:
			w.Record.Changes = append(w.Record.Changes, sync.Change{Entity: Chore, ID: chore.ID, Op: sync.Upsert, Version: chore.Version, Row: chore})
		}
	}
	return w, nil
}
