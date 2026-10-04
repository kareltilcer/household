package arch_test

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Architecture test 12 (PRD 01 §2.3, §10, PRD 05 §6, D-3, D-143; plan item 21, ADR 0022): the staff
// role, which reads across households for the platform staff API, holds no privilege on any table,
// view or sequence but SELECT on the columns staffColumns names, each of which is metadata: what PRD
// 02 §8 lets staff see, and never a field of a content row, a rendered summary, a diff, a file's
// name or a secret. Its read policy (enable_staff_read) admits it to every row of the tenant tables
// it reads, and architecture test 2 holds it to reading; this holds it to the columns. A table-wide
// SELECT would reach every column, one added later included, so only column grants pass, and a
// table staffColumns does not name is one the role reads nothing of.
func TestStaffReadOnlyMetadata(t *testing.T) {
	for _, v := range staffViolations(t, adminTx(t), "", staffColumns) {
		t.Error(v)
	}
}

// The same check against deliberate violations: testdata/staff/tables.sql grants the staff role what
// it may and may not hold, and want.txt is every violation the test must report.
func TestStaffReadOnlyMetadataCatchesEachViolation(t *testing.T) {
	tx := adminTx(t)
	if _, err := tx.Exec(t.Context(), "SET LOCAL ROLE "+db.RoleMigrate); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("testdata", "staff")
	execFile(t, tx, dir, "tables.sql")
	got := staffViolations(t, tx, "arch_testdata", map[string][]string{
		"arch_testdata.named": {"household_id", "name"},
	})
	want := lines(t, os.DirFS(dir), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// staffColumns are the columns the staff role may read, table by table: the metadata PRD 02 §8 and
// PRD 05 §6 let staff see. A column added to a table is not among them until it is added here, and
// adding one is a statement that it is metadata, which the PR that does it makes in the open.
var staffColumns = map[string][]string{
	// A household: its name and where it is, its payer, the state of its subscription and its
	// clocks, whether it is restricted, never why, and its suspension with the platform's own notice.
	"public.households": {"id", "name", "country", "created_at", "billing_payer_id", "billing_state", "trial_ends_at",
		"dunning_ends_at", "grace_ends_at", "lapsed_at", "retained_until", "restricted_at", "suspended_at", "suspension_notice",
		"deletion_scheduled_at"},
	"public.memberships":       {"household_id", "user_id", "role", "created_at"},
	"public.module_enablement": {"household_id", "module", "enabled"},
	// Storage totals per module: bytes, never a file's name or whose it is.
	"public.files": {"household_id", "module", "variant", "byte_size"},
	// Audit action keys, with no summary, no arguments, no diff, no entity and no actor.
	"public.audit_events": {"household_id", "module", "action", "occurred_at"},
	// Delivery outcomes: the message's catalog key and how it went, never what it said or to which
	// address.
	"public.notifications": {"household_id", "id", "user_id", "category", "message", "email", "sealed", "status", "reason",
		"attempts", "created_at", "settled_at", "args_expires_at"},
	"public.notification_deliveries": {"household_id", "id", "notification_id", "user_id", "category", "transport", "status",
		"reason", "sent_at"},
	// The plan and the invoice history, with no processor id, no payment method and no invoice line.
	"public.billing_subscriptions": {"household_id", "payer_id", "standing", "status", "billing_interval", "currency",
		"current_period_end", "cancel_at_period_end", "started_at", "ended_at"},
	"public.billing_invoices": {"household_id", "id", "payer_id", "number", "status", "currency", "total_minor", "tax_minor",
		"issued_at", "period_start", "period_end"},
	// What staff set for a household themselves.
	"public.household_flags":  {"household_id", "key", "enabled", "set_at"},
	"public.household_limits": {"household_id", "key", "value", "reason", "set_by", "set_by_label", "set_at"},
	// Account metadata: the address, its verification, the language, the sign-ins and the devices,
	// and the second step's state, never a name, a credential or a secret.
	"public.users":             {"id", "email", "email_verified_at", "locale", "created_at", "deleted_at"},
	"public.account_deletions": {"user_id", "executes_at"},
	"public.sessions":          {"id", "user_id", "created_at", "last_seen_at", "expires_at", "revoked_at"},
	"public.devices":           {"user_id", "id", "platform", "app_version", "created_at", "last_seen_at"},
	"public.device_sessions":   {"user_id", "device_id", "created_at", "refreshed_at", "revoked_at"},
	"public.mfa_totp":          {"user_id", "activated_at", "locked_at"},
	// A diagnostic bundle, whole: what its member saw in full and chose to send (FR-PS1).
	"public.diagnostic_bundles": {"id", "user_id", "household_id", "screen", "ticket_reference", "payload", "redacted_fields",
		"created_at", "expires_at"},
	// The platform's own tables.
	"platform.staff":         {"user_id", "role", "granted_at", "granted_by"},
	"platform.feature_flags": {"key", "enabled", "updated_at", "updated_by"},
	"platform.audit_log": {"id", "occurred_at", "actor_id", "actor_label", "actor_role", "action", "household_id",
		"target_user_id", "reason", "meta"},
}

// staffViolations returns each privilege the staff role holds in schema, or in every schema that is
// not PostgreSQL's own when schema is "", that allowed does not name: allowed names a table's
// readable columns, and a table it does not name has none.
func staffViolations(t *testing.T, tx pgx.Tx, schema string, allowed map[string][]string) []string {
	t.Helper()
	var out []string
	for _, g := range roleGrants(t, tx, schema, db.RoleStaff) {
		if len(g.whole) > 0 {
			out = append(out, fmt.Sprintf("%s: the staff role holds %s on all of it; grant it SELECT on the columns that are metadata, one at a time",
				g.name, strings.Join(g.whole, ", ")))
			continue
		}
		for _, grant := range g.columns {
			column, privilege, _ := strings.Cut(grant, " ")
			switch {
			case privilege != "SELECT":
				out = append(out, fmt.Sprintf("%s.%s: the staff role holds %s on it; it only reads", g.name, column, privilege))
			case !slices.Contains(allowed[g.name], column):
				out = append(out, fmt.Sprintf("%s.%s: the staff role reads it, and it is not among the metadata staff may see (PRD 02 §8)",
					g.name, column))
			}
		}
	}
	return out
}
