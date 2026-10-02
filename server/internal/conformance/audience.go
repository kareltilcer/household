package conformance

import (
	"context"
	"errors"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/push"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// A conversation is an audience (D-90): its members, each from the floor they joined at, the first
// message they read; and its messages, each keeping on the row its readers, the members whose floor
// it is at or above, which its stream holds a member to (ADR 0001). A message's readers are written
// when it is made, and a member's leaving takes them out of every message's, which is no edit of the
// messages (sync.RewriteAccess). Removing a member from the household takes them out of every
// audience's readers as well (app.Retract).

// ConversationRow is a conversation as the push answers it.
type ConversationRow struct {
	ID          uuid.UUID  `json:"id"`
	HouseholdID uuid.UUID  `json:"household_id"`
	Title       string     `json:"title"`
	Version     int64      `json:"version"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

const conversationColumns = "id, household_id, title, version, deleted_at"

func scanConversation(row pgx.Row) (ConversationRow, error) {
	var c ConversationRow
	err := row.Scan(&c.ID, &c.HouseholdID, &c.Title, &c.Version, &c.DeletedAt)
	return c, err
}

// writeConversation writes a conversation, strict_version, as writeBudget writes a budget: its title.
func writeConversation(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		Title *string `json:"title"`
	}
	if err := push.Decode(m.Fields, []string{"title"}, &f); err != nil {
		return push.Written{}, err
	}
	if f.Title != nil && utf8.RuneCountInString(*f.Title) > 200 {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "title is at most 200 characters")
	}
	current, err := scanConversation(tx.QueryRow(ctx, "SELECT "+conversationColumns+" FROM conformance_conversations WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	var c ConversationRow
	//nolint:exhaustive // A conversation takes no action: every op but these three is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.Title == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a create names its title")
		}
		c, err = scanConversation(tx.QueryRow(ctx, `
			INSERT INTO conformance_conversations (id, household_id, title) VALUES ($1, $2, $3) RETURNING `+conversationColumns,
			m.EntityID, tenant.From(ctx).HouseholdID(), *f.Title))
	case push.Update, push.Delete:
		if !exists {
			return push.Written{}, gone("conversation")
		}
		if err := m.Admit(current); err != nil {
			return push.Written{}, err
		}
		if m.Op == push.Update {
			c, err = scanConversation(update(ctx, tx, "conformance_conversations", m.EntityID, conversationColumns,
				[]set{{"title", f.Title, f.Title != nil}}))
		} else {
			c, err = scanConversation(tx.QueryRow(ctx, "UPDATE conformance_conversations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
				conversationColumns, m.EntityID))
		}
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create, update and delete", Conversation)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return unchanged(current, current.Version), nil
	case err != nil:
		return push.Written{}, err
	}
	return record(event(actionOf(Conversation, m.Op), Conversation, c.ID, map[string]any{"title": c.Title}),
		sync.Change{Entity: Conversation, ID: c.ID, Op: sync.Upsert, Version: c.Version, Row: c}), nil
}

// lockConversation locks the live conversation id until the transaction ends, so that its messages
// draw their places and its members their floors one at a time; false when it is not there.
func lockConversation(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	var found uuid.UUID
	err := tx.QueryRow(ctx, "SELECT id FROM conformance_conversations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// MemberRow is a member of a conversation as the push answers it.
type MemberRow struct {
	ID             uuid.UUID  `json:"id"`
	HouseholdID    uuid.UUID  `json:"household_id"`
	ConversationID uuid.UUID  `json:"conversation_id"`
	UserID         uuid.UUID  `json:"user_id"`
	FloorSeq       int64      `json:"floor_seq"`
	Version        int64      `json:"version"`
	DeletedAt      *time.Time `json:"deleted_at"`
}

const memberColumns = "id, household_id, conversation_id, user_id, floor_seq, version, deleted_at"

func scanMember(row pgx.Row) (MemberRow, error) {
	var mr MemberRow
	err := row.Scan(&mr.ID, &mr.HouseholdID, &mr.ConversationID, &mr.UserID, &mr.FloorSeq, &mr.Version, &mr.DeletedAt)
	return mr, err
}

// writeMember writes a member of a conversation, strict_version. A create adds a member of the
// household to a live conversation from its next message on, their floor: they read nothing written
// before it (FR-CT2, D-90). A delete, made against the version the membership is at, takes them out
// of the conversation and out of the readers of every one of its messages, which retracts the messages
// from their replicas and is no edit of them.
func writeMember(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		ConversationID *uuid.UUID `json:"conversation_id"`
		UserID         *uuid.UUID `json:"user_id"`
	}
	var allowed []string
	if m.Op == push.Create {
		allowed = []string{"conversation_id", "user_id"}
	}
	if err := push.Decode(m.Fields, allowed, &f); err != nil {
		return push.Written{}, err
	}
	household := tenant.From(ctx).HouseholdID()
	current, err := scanMember(tx.QueryRow(ctx, "SELECT "+memberColumns+" FROM conformance_conversation_members WHERE id = $1", m.EntityID))
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return push.Written{}, err
	}
	var mr MemberRow
	//nolint:exhaustive // A membership takes no action and no update: every other op is refused below.
	switch m.Op {
	case push.Create:
		if exists {
			return unchanged(current, current.Version), nil
		}
		if f.ConversationID == nil || f.UserID == nil {
			return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a member names its conversation_id and its user_id")
		}
		live, lockErr := lockConversation(ctx, tx, *f.ConversationID)
		if lockErr != nil {
			return push.Written{}, lockErr
		}
		var member bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM memberships WHERE household_id = $1 AND user_id = $2)", household, *f.UserID).
			Scan(&member); err != nil {
			return push.Written{}, err
		}
		if !live || !member {
			return push.Written{}, gone("conversation or member")
		}
		mr, err = scanMember(tx.QueryRow(ctx, `
			INSERT INTO conformance_conversation_members (id, household_id, conversation_id, user_id, floor_seq)
			SELECT $1, $2, $3, $4, coalesce(max(seq), 0) + 1 FROM conformance_messages WHERE household_id = $2 AND conversation_id = $3
			RETURNING `+memberColumns, m.EntityID, household, *f.ConversationID, *f.UserID))
		if err != nil {
			return push.Written{}, err
		}
	case push.Delete:
		if !exists {
			return push.Written{}, gone("member")
		}
		if err := m.Admit(current); err != nil {
			return push.Written{}, err
		}
		mr, err = scanMember(tx.QueryRow(ctx, "UPDATE conformance_conversation_members SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING "+
			memberColumns, m.EntityID))
		if errors.Is(err, pgx.ErrNoRows) {
			return unchanged(current, current.Version), nil
		}
		if err != nil {
			return push.Written{}, err
		}
		if _, err := sync.RewriteAccess(ctx, tx, []string{sync.ReadersColumn}, `
			UPDATE conformance_messages SET readers = array_remove(readers, $3)
			WHERE household_id = $1 AND conversation_id = $2 AND $3 = ANY (readers)`, household, mr.ConversationID, mr.UserID); err != nil {
			return push.Written{}, err
		}
	default:
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "%s takes create and delete", ConversationMember)
	}
	return record(event(actionOf(ConversationMember, m.Op), ConversationMember, mr.ID, map[string]any{"user_id": mr.UserID}),
		sync.Change{Entity: ConversationMember, ID: mr.ID, Op: sync.Upsert, Version: mr.Version, Row: mr}), nil
}

// MessageRow is a message as the push answers it.
type MessageRow struct {
	ID             uuid.UUID   `json:"id"`
	HouseholdID    uuid.UUID   `json:"household_id"`
	ConversationID uuid.UUID   `json:"conversation_id"`
	Seq            int64       `json:"seq"`
	Body           string      `json:"body"`
	Readers        []uuid.UUID `json:"readers"`
	Version        int64       `json:"version"`
}

const messageColumns = "id, household_id, conversation_id, seq, body, readers, version"

func scanMessage(row pgx.Row) (MessageRow, error) {
	var mr MessageRow
	err := row.Scan(&mr.ID, &mr.HouseholdID, &mr.ConversationID, &mr.Seq, &mr.Body, &mr.Readers, &mr.Version)
	return mr, err
}

// writeMessage writes a message, additive: a create, by a member of its conversation, which takes the
// conversation's next place and, as its readers, the members whose floor that place is at or above.
// A caller not in the conversation, removed from it while their message waited in their queue among
// them, is answered as one who cannot see it: not_found. A create of an id the household holds finds
// its row and writes nothing.
func writeMessage(ctx context.Context, tx pgx.Tx, m push.Mutation) (push.Written, error) {
	var f struct {
		ConversationID *uuid.UUID `json:"conversation_id"`
		Body           *string    `json:"body"`
	}
	if err := push.Decode(m.Fields, []string{"conversation_id", "body"}, &f); err != nil {
		return push.Written{}, err
	}
	if f.ConversationID == nil || f.Body == nil {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "a message names its conversation_id and its body")
	}
	if utf8.RuneCountInString(*f.Body) > 4000 {
		return push.Written{}, push.Refuse(problem.CodeValidationFailed, "body is at most 4000 characters")
	}
	scope := tenant.From(ctx)
	current, err := scanMessage(tx.QueryRow(ctx, "SELECT "+messageColumns+" FROM conformance_messages WHERE id = $1", m.EntityID))
	switch {
	case err == nil:
		return unchanged(current, current.Version), nil
	case !errors.Is(err, pgx.ErrNoRows):
		return push.Written{}, err
	}
	live, err := lockConversation(ctx, tx, *f.ConversationID)
	if err != nil {
		return push.Written{}, err
	}
	var member bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT FROM conformance_conversation_members
		               WHERE household_id = $1 AND conversation_id = $2 AND user_id = $3 AND deleted_at IS NULL)`,
		scope.HouseholdID(), *f.ConversationID, scope.UserID()).Scan(&member); err != nil {
		return push.Written{}, err
	}
	if !live || !member {
		return push.Written{}, gone("conversation")
	}
	mr, err := scanMessage(tx.QueryRow(ctx, `
		WITH place AS (
		  SELECT coalesce(max(seq), 0) + 1 AS seq FROM conformance_messages WHERE household_id = $2 AND conversation_id = $3
		)
		INSERT INTO conformance_messages (id, household_id, conversation_id, seq, body, readers)
		SELECT $1, $2, $3, place.seq, $4,
		  coalesce((SELECT array_agg(c.user_id ORDER BY c.user_id) FROM conformance_conversation_members c
		            WHERE c.household_id = $2 AND c.conversation_id = $3 AND c.deleted_at IS NULL AND c.floor_seq <= place.seq), '{}')
		FROM place
		RETURNING `+messageColumns, m.EntityID, scope.HouseholdID(), *f.ConversationID, *f.Body))
	if err != nil {
		return push.Written{}, err
	}
	return record(event("message.create", Message, mr.ID, nil),
		sync.Change{Entity: Message, ID: mr.ID, Op: sync.Upsert, Version: mr.Version, Row: mr}), nil
}
