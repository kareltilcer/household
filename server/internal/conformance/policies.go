package conformance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// set is a column an update sets, when set says it does.
type set struct {
	column string
	value  any
	set    bool
}

// noRow is a row that is not there.
type noRow struct{}

func (noRow) Scan(...any) error { return pgx.ErrNoRows }

// update sets the columns of sets that are set on table's row id, where any of them changes, and
// returns the row as returning selects it: no row when none is set or none would change, which
// writes nothing.
func update(ctx context.Context, tx pgx.Tx, table string, id uuid.UUID, returning string, sets []set) pgx.Row {
	var assigns, changes []string
	args := []any{id}
	for _, s := range sets {
		if !s.set {
			continue
		}
		args = append(args, s.value)
		assigns = append(assigns, fmt.Sprintf("%s = $%d", s.column, len(args)))
		changes = append(changes, fmt.Sprintf("%s IS DISTINCT FROM $%d", s.column, len(args)))
	}
	if len(assigns) == 0 {
		return noRow{}
	}
	return tx.QueryRow(ctx, "UPDATE "+table+" SET "+strings.Join(assigns, ", ")+
		" WHERE id = $1 AND ("+strings.Join(changes, " OR ")+") RETURNING "+returning, args...)
}

// record is what a write that recorded ev and wrote the rows of changes came to, answered with the
// first's row.
func record(ev audit.Event, changes ...sync.Change) push.Written {
	return push.Written{Record: mutation.Record{Event: ev, Changes: changes}, Row: changes[0].Row, Version: changes[0].Version}
}

// event is the audit event of action on entity id, which summary describes.
func event(action, entity string, id uuid.UUID, summary map[string]any) audit.Event {
	return audit.Event{
		Module: Name, Action: action, EntityType: entity, EntityID: id, SummaryKey: Name + "." + action, SummaryArgs: summary,
	}
}

// actionOf is the audit action a create, an update or a delete of entity records: "budget.create".
func actionOf(entity string, op push.Op) string {
	_, short, _ := strings.Cut(entity, ".")
	return short + "." + string(op)
}

// unchanged is the answer to a write that found what it asks for in place: the row as it stands.
func unchanged(row any, version int64) push.Written { return push.Written{Row: row, Version: version} }

// gone refuses a write to a row that is not there, or that the caller may not see.
func gone(entity string) error {
	return push.Refuse(problem.CodeNotFound, "the %s is not there", entity)
}

// BudgetRow is a budget as the push answers it.
type BudgetRow struct {
	ID          uuid.UUID  `json:"id"`
	HouseholdID uuid.UUID  `json:"household_id"`
	Name        string     `json:"name"`
	AmountMinor int64      `json:"amount_minor"`
	Currency    string     `json:"currency"`
	Version     int64      `json:"version"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

const budgetColumns = "id, household_id, name, amount_minor, currency, version, deleted_at"

func scanBudget(row pgx.Row) (BudgetRow, error) {
	var b BudgetRow
	err := row.Scan(&b.ID, &b.HouseholdID, &b.Name, &b.AmountMinor, &b.Currency, &b.Version, &b.DeletedAt)
	return b, err
}

var currency = regexp.MustCompile(`^[A-Z]{3}$`)

// writeBudget writes a budget, strict_version: a create; and an update or a delete only against the
// version the row is at (Mutation.Admit), a write made against another refused as a conflict carrying
// the row as it stands. A create of an id the household holds finds its row and writes nothing.
func writeBudget(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		Name        *string `json:"name"`
		AmountMinor *int64  `json:"amount_minor"`
		Currency    *string `json:"currency"`
	}
	if err := push.Decode(m.Fields, []string{"name", "amount_minor", "currency"}, &f); err != nil {
		return push.Written{}, err
	}
	switch {
	case f.Name != nil && (*f.Name == "" || utf8.RuneCountInString(*f.Name) > 200):
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "name is 1 to 200 characters")
	case f.Currency != nil && !currency.MatchString(*f.Currency):
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "currency is an ISO 4217 code")
	}
	household := tenant.From(ctx).HouseholdID()
	current, err := scanBudget(tx.QueryRow(ctx, "SELECT "+budgetColumns+" FROM conformance_budgets WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	var b BudgetRow
	//nolint:exhaustive // A budget takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.Name == nil || f.AmountMinor == nil || f.Currency == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a create names its name, its amount_minor and its currency")
		}
		b, err = scanBudget(tx.QueryRow(ctx, `
			INSERT INTO conformance_budgets (id, household_id, name, amount_minor, currency) VALUES ($1, $2, $3, $4, $5)
			RETURNING `+budgetColumns, m.EntityID, household, *f.Name, *f.AmountMinor, *f.Currency))
	case push.Update, push.Delete:
		if !exists {
			return push.Written{}, gone("budget")
		}
		if err := m.Admit(current); err != nil {
			return push.Written{}, err
		}
		if m.Op == push.Update {
			b, err = scanBudget(update(ctx, tx, "conformance_budgets", m.EntityID, budgetColumns, []set{
				{"name", f.Name, f.Name != nil}, {"amount_minor", f.AmountMinor, f.AmountMinor != nil}, {"currency", f.Currency, f.Currency != nil},
			}))
		} else {
			b, err = scanBudget(tx.QueryRow(ctx, "UPDATE conformance_budgets SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
				budgetColumns, m.EntityID))
		}
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Budget)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return unchanged(current, current.Version), nil
	case err != nil:
		return push.Written{}, err
	}
	return record(event(actionOf(Budget, m.Op), Budget, b.ID, map[string]any{"name": b.Name}),
		sync.Change{Entity: Budget, ID: b.ID, Op: sync.Upsert, Version: b.Version, Row: b}), nil
}

// NoteRow is a note as the push answers it.
type NoteRow struct {
	ID          uuid.UUID  `json:"id"`
	HouseholdID uuid.UUID  `json:"household_id"`
	Visibility  string     `json:"visibility"`
	OwnerID     *uuid.UUID `json:"owner_id"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	Version     int64      `json:"version"`
	UpdatedBy   *uuid.UUID `json:"updated_by"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

const noteColumns = "id, household_id, visibility, owner_id, title, body, version, updated_by, deleted_at"

func scanNote(row pgx.Row) (NoteRow, error) {
	var n NoteRow
	err := row.Scan(&n.ID, &n.HouseholdID, &n.Visibility, &n.OwnerID, &n.Title, &n.Body, &n.Version, &n.UpdatedBy, &n.DeletedAt)
	return n, err
}

// private reports whether a row of visibility and owner is private, and whose.
func private(visibility string, owner *uuid.UUID) (bool, uuid.UUID) {
	if visibility != string(sync.Private) || owner == nil {
		return false, uuid.Nil
	}
	return true, *owner
}

// hidden reports whether a row of visibility and owner is another member's private row, which the
// caller may not see: the module answers it as a row that is not there (404, not 403).
func hidden(ctx context.Context, visibility string, owner *uuid.UUID) bool {
	mine, whose := private(visibility, owner)
	return mine && whose != tenant.From(ctx).UserID()
}

// privately makes ev and change, about a row of visibility and owner, private to its owner when the
// row is: the activity log shows another member nothing of it (FR-AU4), and the spine refuses a
// private change in a shared event.
func privately(ev audit.Event, change sync.Change, visibility string, owner *uuid.UUID) (audit.Event, sync.Change) {
	if is, whose := private(visibility, owner); is {
		ev.Visibility, ev.Owner = audit.Private, whose
		change.Visibility, change.Owner = sync.Private, whose
	}
	return ev, change
}

// writeNote writes a note, lww_row: a create, an update and a delete, each of a note the caller may
// see, the last write by server receipt winning the whole row. An update made against an older
// version than the note's (Mutation.Behind) preserves the note it replaces, the loser, in
// conformance_note_versions with the version it stood at and the version the update was made
// against (PRD 03 §2.5, D-122), and the push answers it merged. A note is shared, or private to the
// member who makes it so, which they alone may: its visibility and its owner are rewritten on every
// comment it bounds, which is no edit of them (sync.RewriteAccess, ADR 0018).
func writeNote(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		Visibility *string    `json:"visibility"`
		OwnerID    *uuid.UUID `json:"owner_id"`
		Title      *string    `json:"title"`
		Body       *string    `json:"body"`
	}
	if err := push.Decode(m.Fields, []string{"visibility", "owner_id", "title", "body"}, &f); err != nil {
		return push.Written{}, err
	}
	switch {
	case f.Title != nil && utf8.RuneCountInString(*f.Title) > 200:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "title is at most 200 characters")
	case f.Body != nil && utf8.RuneCountInString(*f.Body) > 20000:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "body is at most 20000 characters")
	case f.Visibility != nil && *f.Visibility != string(sync.Shared) && *f.Visibility != string(sync.Private):
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "visibility is shared or private")
	}
	scope := tenant.From(ctx)
	current, err := scanNote(tx.QueryRow(ctx, "SELECT "+noteColumns+" FROM conformance_notes WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	if exists && hidden(ctx, current.Visibility, current.OwnerID) {
		return push.Written{}, gone("note")
	}
	// The visibility the write leaves the note with, and its owner: the caller's when it is private,
	// since a member makes a note private to themselves alone, and nobody's when it is shared.
	visibility := string(sync.Shared)
	if exists {
		visibility = current.Visibility
	}
	if f.Visibility != nil {
		visibility = *f.Visibility
	}
	var owner *uuid.UUID
	if visibility == string(sync.Private) {
		me := scope.UserID()
		if exists && current.OwnerID != nil {
			me = *current.OwnerID
		}
		owner = &me
	}
	if f.OwnerID != nil && (owner == nil || *f.OwnerID != *owner) {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a private note is its maker's, and a shared note nobody's")
	}
	var n NoteRow
	//nolint:exhaustive // A note takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.Title == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a create names its title")
		}
		body := ""
		if f.Body != nil {
			body = *f.Body
		}
		n, err = scanNote(tx.QueryRow(ctx, `
			INSERT INTO conformance_notes (id, household_id, visibility, owner_id, title, body) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING `+noteColumns, m.EntityID, scope.HouseholdID(), visibility, owner, *f.Title, body))
	case push.Update:
		if !exists {
			return push.Written{}, gone("note")
		}
		if m.Behind() {
			if err := preserve(ctx, tx, m, current); err != nil {
				return push.Written{}, err
			}
		}
		moved := visibility != current.Visibility
		n, err = scanNote(update(ctx, tx, "conformance_notes", m.EntityID, noteColumns, []set{
			{"visibility", visibility, moved}, {"owner_id", owner, moved},
			{"title", f.Title, f.Title != nil}, {"body", f.Body, f.Body != nil},
		}))
		if err == nil && moved {
			if _, err = sync.RewriteAccess(ctx, tx, []string{sync.VisibilityColumn, sync.OwnerColumn}, `
				UPDATE conformance_note_comments SET visibility = $3, owner_id = $4
				WHERE household_id = $1 AND note_id = $2`, scope.HouseholdID(), n.ID, n.Visibility, n.OwnerID); err != nil {
				return push.Written{}, err
			}
		}
	case push.Delete:
		if !exists {
			return push.Written{}, gone("note")
		}
		n, err = scanNote(tx.QueryRow(ctx, "UPDATE conformance_notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
			noteColumns, m.EntityID))
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Note)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return unchanged(current, current.Version), nil
	case err != nil:
		return push.Written{}, err
	}
	ev, change := privately(event(actionOf(Note, m.Op), Note, n.ID, map[string]any{"title": n.Title}),
		sync.Change{Entity: Note, ID: n.ID, Op: sync.Upsert, Version: n.Version, Row: n}, n.Visibility, n.OwnerID)
	return record(ev, change), nil
}

// preserve keeps current, the note m's update replaces whole although it was made against an older
// version, with the version it stood at, the version m was made against, who wrote it and who
// replaced it: whole-row last-write-wins preserves its loser (PRD 03 §2.5).
func preserve(ctx context.Context, tx pgx.Tx, m push.Mutation, current NoteRow) error {
	row, err := json.Marshal(current)
	if err != nil {
		return err
	}
	scope := tenant.From(ctx)
	_, err = tx.Exec(ctx, `
		INSERT INTO conformance_note_versions (id, household_id, note_id, version, base_version, row, written_by, superseded_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		idgen.New(), scope.HouseholdID(), current.ID, current.Version, *m.BaseVersion, row, current.UpdatedBy, scope.UserID())
	return err
}

// CommentRow is a note's comment as the push answers it.
type CommentRow struct {
	ID          uuid.UUID  `json:"id"`
	HouseholdID uuid.UUID  `json:"household_id"`
	NoteID      uuid.UUID  `json:"note_id"`
	Visibility  string     `json:"visibility"`
	OwnerID     *uuid.UUID `json:"owner_id"`
	Body        string     `json:"body"`
	Version     int64      `json:"version"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

const commentColumns = "id, household_id, note_id, visibility, owner_id, body, version, deleted_at"

func scanComment(row pgx.Row) (CommentRow, error) {
	var c CommentRow
	err := row.Scan(&c.ID, &c.HouseholdID, &c.NoteID, &c.Visibility, &c.OwnerID, &c.Body, &c.Version, &c.DeletedAt)
	return c, err
}

// writeComment writes a note's comment, lww_field: a create of a comment on a note the caller may
// see, which takes the note's visibility and owner, the note locked until the write commits so that it
// cannot move between shared and private meanwhile; an update of its body, and a delete, of a comment
// the caller may see.
func writeComment(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		NoteID *uuid.UUID `json:"note_id"`
		Body   *string    `json:"body"`
	}
	allowed := []string{"body"}
	if m.Op == push.Create {
		allowed = append(allowed, "note_id")
	}
	if err := push.Decode(m.Fields, allowed, &f); err != nil {
		return push.Written{}, err
	}
	if f.Body != nil && (*f.Body == "" || utf8.RuneCountInString(*f.Body) > 2000) {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "body is 1 to 2000 characters")
	}
	household := tenant.From(ctx).HouseholdID()
	current, err := scanComment(tx.QueryRow(ctx, "SELECT "+commentColumns+" FROM conformance_note_comments WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	if exists && hidden(ctx, current.Visibility, current.OwnerID) {
		return push.Written{}, gone("comment")
	}
	var c CommentRow
	//nolint:exhaustive // A comment takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.NoteID == nil || f.Body == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a comment names its note_id and its body")
		}
		var (
			visibility string
			owner      *uuid.UUID
		)
		switch found := tx.QueryRow(ctx, "SELECT visibility, owner_id FROM conformance_notes WHERE id = $1 AND deleted_at IS NULL FOR SHARE",
			*f.NoteID).Scan(&visibility, &owner); {
		case errors.Is(found, pgx.ErrNoRows):
			return push.Written{}, gone("note")
		case found != nil:
			return push.Written{}, found
		case hidden(ctx, visibility, owner):
			return push.Written{}, gone("note")
		}
		c, err = scanComment(tx.QueryRow(ctx, `
			INSERT INTO conformance_note_comments (id, household_id, note_id, visibility, owner_id, body) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING `+commentColumns, m.EntityID, household, *f.NoteID, visibility, owner, *f.Body))
	case push.Update:
		if !exists {
			return push.Written{}, gone("comment")
		}
		c, err = scanComment(update(ctx, tx, "conformance_note_comments", m.EntityID, commentColumns, []set{{"body", f.Body, f.Body != nil}}))
	case push.Delete:
		if !exists {
			return push.Written{}, gone("comment")
		}
		c, err = scanComment(tx.QueryRow(ctx, "UPDATE conformance_note_comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
			commentColumns, m.EntityID))
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", NoteComment)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return unchanged(current, current.Version), nil
	case err != nil:
		return push.Written{}, err
	}
	ev, change := privately(event(actionOf(NoteComment, m.Op), NoteComment, c.ID, nil),
		sync.Change{Entity: NoteComment, ID: c.ID, Op: sync.Upsert, Version: c.Version, Row: c}, c.Visibility, c.OwnerID)
	return record(ev, change), nil
}

// ChoreRow is a chore as the push answers it.
type ChoreRow struct {
	ID            uuid.UUID   `json:"id"`
	HouseholdID   uuid.UUID   `json:"household_id"`
	Name          string      `json:"name"`
	Rotation      []uuid.UUID `json:"rotation"`
	RotationIndex int         `json:"rotation_index"`
	Version       int64       `json:"version"`
	DeletedAt     *time.Time  `json:"deleted_at"`
}

const choreColumns = "id, household_id, name, rotation, rotation_index, version, deleted_at"

func scanChore(row pgx.Row) (ChoreRow, error) {
	var c ChoreRow
	err := row.Scan(&c.ID, &c.HouseholdID, &c.Name, &c.Rotation, &c.RotationIndex, &c.Version, &c.DeletedAt)
	return c, err
}

// writeChore writes a chore, strict_version, as writeBudget writes a budget: its name and the members
// it rotates through. Its place in the rotation is the server's, which a completion advances (D-52).
func writeChore(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		Name     *string      `json:"name"`
		Rotation *[]uuid.UUID `json:"rotation"`
	}
	if err := push.Decode(m.Fields, []string{"name", "rotation"}, &f); err != nil {
		return push.Written{}, err
	}
	if f.Name != nil && (*f.Name == "" || utf8.RuneCountInString(*f.Name) > 200) {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "name is 1 to 200 characters")
	}
	household := tenant.From(ctx).HouseholdID()
	current, err := scanChore(tx.QueryRow(ctx, "SELECT "+choreColumns+" FROM conformance_chores WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	var c ChoreRow
	//nolint:exhaustive // A chore takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.Name == nil || f.Rotation == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a create names its name and its rotation")
		}
		c, err = scanChore(tx.QueryRow(ctx, `
			INSERT INTO conformance_chores (id, household_id, name, rotation) VALUES ($1, $2, $3, $4) RETURNING `+choreColumns,
			m.EntityID, household, *f.Name, *f.Rotation))
	case push.Update, push.Delete:
		if !exists {
			return push.Written{}, gone("chore")
		}
		if err := m.Admit(current); err != nil {
			return push.Written{}, err
		}
		if m.Op == push.Update {
			// A shorter rotation keeps the chore's place within it.
			c, err = scanChore(update(ctx, tx, "conformance_chores", m.EntityID, choreColumns, []set{
				{"name", f.Name, f.Name != nil}, {"rotation", f.Rotation, f.Rotation != nil},
				{"rotation_index", 0, f.Rotation != nil && current.RotationIndex >= len(*f.Rotation)},
			}))
		} else {
			c, err = scanChore(tx.QueryRow(ctx, "UPDATE conformance_chores SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
				choreColumns, m.EntityID))
		}
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Chore)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return unchanged(current, current.Version), nil
	case err != nil:
		return push.Written{}, err
	}
	return record(event(actionOf(Chore, m.Op), Chore, c.ID, map[string]any{"name": c.Name}),
		sync.Change{Entity: Chore, ID: c.ID, Op: sync.Upsert, Version: c.Version, Row: c}), nil
}

// AttachmentRow is an attachment's row as the push answers it.
type AttachmentRow struct {
	ID               uuid.UUID  `json:"id"`
	HouseholdID      uuid.UUID  `json:"household_id"`
	ItemID           uuid.UUID  `json:"item_id"`
	FileName         string     `json:"file_name"`
	AttachmentStatus string     `json:"attachment_status"`
	FailureReason    *string    `json:"failure_reason"`
	Version          int64      `json:"version"`
	DeletedAt        *time.Time `json:"deleted_at"`
}

const attachmentColumns = "id, household_id, item_id, file_name, attachment_status, failure_reason, version, deleted_at"

func scanAttachment(row pgx.Row) (AttachmentRow, error) {
	var a AttachmentRow
	err := row.Scan(&a.ID, &a.HouseholdID, &a.ItemID, &a.FileName, &a.AttachmentStatus, &a.FailureReason, &a.Version, &a.DeletedAt)
	return a, err
}

// The states of an attachment's bytes (D-25): pending until they arrive, ready once they have, and
// failed, with a reason, when they never can.
const (
	attachmentPending = "pending"
	attachmentReady   = "ready"
	attachmentFailed  = "failed"
)

// writeAttachment writes an attachment's row, lww_field: a create, pending, which a client makes
// offline before its bytes are uploaded (D-25); an update of its file name; and a delete. Whether its
// bytes arrived is the server's to say, as their upload ends (upload.go): a client sets no status
// but pending.
func writeAttachment(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		ItemID           *uuid.UUID `json:"item_id"`
		FileName         *string    `json:"file_name"`
		AttachmentStatus *string    `json:"attachment_status"`
	}
	allowed := []string{"file_name"}
	if m.Op == push.Create {
		allowed = append(allowed, "item_id", "attachment_status")
	}
	if err := push.Decode(m.Fields, allowed, &f); err != nil {
		return push.Written{}, err
	}
	switch {
	case f.FileName != nil && (*f.FileName == "" || utf8.RuneCountInString(*f.FileName) > 255):
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "file_name is 1 to 255 characters")
	case f.AttachmentStatus != nil && *f.AttachmentStatus != attachmentPending:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "an attachment is made pending; its upload says what became of it")
	}
	household := tenant.From(ctx).HouseholdID()
	current, err := scanAttachment(tx.QueryRow(ctx, "SELECT "+attachmentColumns+" FROM conformance_attachments WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	var a AttachmentRow
	//nolint:exhaustive // An attachment takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.ItemID == nil || f.FileName == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "an attachment names its item_id and its file_name")
		}
		a, err = scanAttachment(tx.QueryRow(ctx, `
			INSERT INTO conformance_attachments (id, household_id, item_id, file_name, attachment_status) VALUES ($1, $2, $3, $4, $5)
			RETURNING `+attachmentColumns, m.EntityID, household, *f.ItemID, *f.FileName, attachmentPending))
	case push.Update:
		if !exists {
			return push.Written{}, gone("attachment")
		}
		a, err = scanAttachment(update(ctx, tx, "conformance_attachments", m.EntityID, attachmentColumns,
			[]set{{"file_name", f.FileName, f.FileName != nil}}))
	case push.Delete:
		if !exists {
			return push.Written{}, gone("attachment")
		}
		a, err = scanAttachment(tx.QueryRow(ctx, "UPDATE conformance_attachments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
			attachmentColumns, m.EntityID))
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Attachment)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return unchanged(current, current.Version), nil
	case err != nil:
		return push.Written{}, err
	}
	return record(event(actionOf(Attachment, m.Op), Attachment, a.ID, map[string]any{"file_name": a.FileName}),
		sync.Change{Entity: Attachment, ID: a.ID, Op: sync.Upsert, Version: a.Version, Row: a}), nil
}
