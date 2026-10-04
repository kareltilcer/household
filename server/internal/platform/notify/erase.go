package notify

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// What erasure deletes of the notification tables (FR-PR4; plan item 20). A household's go with its
// row, which every one of them hangs from; these are an erased account's.

// EraseAccount deletes, in tx, what the transport keeps of user's account outside any household:
// where their browsers are reached, and what they want to be told by default. Their devices' tokens
// and the receipts awaited for them go with the devices, which identity deletes.
func EraseAccount(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	for _, table := range []string{"push_subscriptions", "notification_defaults"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE user_id = $1", user); err != nil {
			return err
		}
	}
	return nil
}

// EraseMember deletes, in tx, a transaction of household's, what the transport keeps of user there:
// every notification queued for them or sent to them, with the log of its deliveries, and what they
// asked to be told in that household, which outlives a membership ended otherwise only until the
// membership's row goes. The household's own log of what it told its other members is untouched.
func EraseMember(ctx context.Context, tx pgx.Tx, household, user uuid.UUID) error {
	for _, table := range []string{"notification_deliveries", "notifications", "notification_preferences"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE household_id = $1 AND user_id = $2", household, user); err != nil {
			return err
		}
	}
	return nil
}

// AccountExport is what the transport keeps of user's account as their export carries it (FR-PR2):
// what they asked to be told by default, null for an account that set nothing, and how many browsers
// a push reaches them in, whose endpoints are credentials and are left out.
func AccountExport(ctx context.Context, tx pgx.Tx, user uuid.UUID) (map[string]any, error) {
	var defaults []byte
	err := tx.QueryRow(ctx, `
		SELECT (SELECT to_jsonb(d) - 'user_id' FROM notification_defaults d WHERE d.user_id = $1)`, user).Scan(&defaults)
	if err != nil {
		return nil, err
	}
	var browsers int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM push_subscriptions WHERE user_id = $1", user).Scan(&browsers); err != nil {
		return nil, err
	}
	out := map[string]any{"browser_subscriptions": browsers, "defaults": nil}
	if defaults != nil {
		// As PostgreSQL wrote it, embedded as it is.
		out["defaults"] = json.RawMessage(defaults)
	}
	return out, nil
}
