package conformance_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/push"
)

// A household that does not write refuses the push's batch whole, 402, with the code of its state
// (FR-BI2, D-118): nothing in the batch is applied, and nothing is kept, so that the batch the client
// holds and sends again once the household writes again is applied as if it were the first time. A
// replica's credentials are handed out all the while (D-117), and in no state but suspended, where
// the push and the credentials both answer 404 (D-115).
func TestThePushIsRefusedWholeWhileTheHouseholdDoesNotWrite(t *testing.T) {
	w := newWorld(t, apptest.Options{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	milk, honey := idgen.New(), idgen.New()
	batch := []map[string]any{
		mutationOf(conformance.Item, "create", milk, map[string]any{"title": "Milk"}),
		mutationOf(conformance.Item, "create", honey, map[string]any{"title": "Honey"}),
	}
	refused := func(code problem.Code, state string) {
		t.Helper()
		rec := w.push(household, token, key(), batch...)
		var p struct {
			Code   problem.Code `json:"code"`
			State  string       `json:"state"`
			Remedy string       `json:"remedy"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || rec.Code != http.StatusPaymentRequired || p.Code != code ||
			p.State != state || p.Remedy != "contact_owner" {
			t.Fatalf("the push answered %d %s", rec.Code, rec.Body)
		}
		if n := w.count("SELECT count(*) FROM conformance_items WHERE household_id = $1", household); n != 0 {
			t.Fatalf("%d items written", n)
		}
		if n := w.count("SELECT count(*) FROM sync_mutations WHERE household_id = $1", household); n != 0 {
			t.Fatalf("%d answers kept", n)
		}
		if got := w.credentials(household, bearer(token)).Code; got != http.StatusOK {
			t.Fatalf("the credentials answered %d", got)
		}
	}

	w.exec("UPDATE households SET billing_state = 'read_only', lapsed_at = now(), retained_until = now() + interval '395 days' WHERE id = $1", household)
	refused(problem.CodeEntitlementReadOnly, "read_only")
	w.exec("UPDATE households SET billing_state = 'active', lapsed_at = NULL, retained_until = NULL, restricted_at = now(), restricted_by_label = 'Jana' WHERE id = $1", household)
	refused(problem.CodeEntitlementRestricted, "restricted")

	w.exec("UPDATE households SET restricted_at = NULL, restricted_by_label = NULL WHERE id = $1", household)
	if got := outcomes(w.results(w.push(household, token, key(), batch...))); len(got) != 2 || got[0] != push.Applied || got[1] != push.Applied {
		t.Fatalf("the batch sent again: %v", got)
	}

	w.exec("UPDATE households SET suspended_at = now() WHERE id = $1", household)
	if got := w.push(household, token, key(), mutationOf(conformance.Item, "update", milk, map[string]any{"title": "Oat milk"})); got.Code != http.StatusNotFound {
		t.Fatalf("a suspended household's push answered %d %s", got.Code, got.Body)
	}
	if got := w.credentials(household, bearer(token)).Code; got != http.StatusNotFound {
		t.Fatalf("a suspended household's credentials answered %d", got)
	}
}

// counted is the conformance module declaring its items' table to the storage catalog, whose rows
// fair use then counts (module.StorageSource).
type counted struct{ conformance.Module }

func (counted) StorageTables() []string { return []string{"conformance_items"} }

func (counted) StorageLabels(context.Context, pgx.Tx, []uuid.UUID) (map[uuid.UUID]string, error) {
	return map[uuid.UUID]string{}, nil
}

// A create the push applies is held to the rows its module may hold as a REST create is, by the
// mutation spine (PRD 04 §5, D-116): past them it is rejected fair_use_ceiling, and the rest of the
// batch goes on.
func TestThePushHoldsAModuleToItsRows(t *testing.T) {
	w := newWorldOf(t, apptest.Options{}, counted{})
	household, member := w.household("contribute")
	token := w.signIn(member, 0)
	w.exec(`INSERT INTO conformance_items (id, household_id, title) SELECT gen_random_uuid(), $1, 'Item'
		FROM generate_series(1, $2::int)`, household, fairuse.Rows)
	w.exec(`INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count)
		VALUES ($1, current_date, now(), 0, 0, 0)`, household)
	w.exec(`INSERT INTO usage_sample_modules (household_id, sampled_on, module, stored_bytes, derived_bytes, object_count, row_count)
		VALUES ($1, current_date, $2, 0, 0, 0, $3)`, household, conformance.Name, fairuse.Rows)
	existing := uuid.Nil
	if err := w.admin.QueryRow(context.Background(), "SELECT id FROM conformance_items WHERE household_id = $1 LIMIT 1", household).
		Scan(&existing); err != nil {
		t.Fatal(err)
	}
	honey := idgen.New()
	got := outcomes(w.results(w.push(household, token, key(),
		mutationOf(conformance.Item, "create", honey, map[string]any{"title": "Honey"}),
		mutationOf(conformance.Item, "update", existing, map[string]any{"title": "Milk"}),
	)))
	if len(got) != 2 || got[0] != push.Rejected+" "+string(problem.CodeFairUseCeiling) || got[1] != push.Applied {
		t.Fatalf("outcomes %v", got)
	}
	if n := w.count("SELECT count(*) FROM conformance_items WHERE id = $1", honey); n != 0 {
		t.Fatal("the refused create was written")
	}
}
