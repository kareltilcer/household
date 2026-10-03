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

// Architecture test 2 (PRD 01 §2.2, §10, D-2): every tenant table carries household_id uuid NOT
// NULL, enables and forces row-level security, and has as its only permissive policies the
// tenant isolation that enable_tenant_isolation creates and the meter role's read beside it
// (enable_metering), which reaches that role alone. Another permissive policy would widen what a
// household can read, since permissive policies are ORed; a rule narrower than the tenant's is a
// restrictive policy, which is ANDed with it, and names the roles it narrows, since one that
// reached the meter role would hide rows from the usage sample. A materialized view cannot hold a
// policy at all, so none may hold a household's rows. A table exempted for a policy of its own
// may read more widely than its household, but only in a FOR SELECT policy: it is written only
// in its household's context. No global table's row, deleted or updated by the request role,
// changes a household's rows through a foreign key's action: a referential action runs past
// row-level security, so it would reach every household from any household's context. And a
// foreign key between two tables that hold households' rows pairs their households' columns:
// PostgreSQL checks a foreign key past row-level security too, so a key on an id alone lets a
// row of one household name another household's row, whose delete there is then refused, or
// acts on this household's row. A partition is held to all of it, since a query that reaches a
// partition directly is held to the partition's own policies, and it takes no privilege of the
// request role's, which reaches it only through its parent, whose privileges then hold: a
// partition the request role could delete from would undo an append-only parent.
//
// It reads the schema from PostgreSQL's catalog, as the migrations left it in the package's
// database: every table in every schema, whichever migration made it and however it spelled
// it. A table is a tenant table unless exemptions names it.
func TestTenantTablesAreIsolated(t *testing.T) {
	for _, v := range tenancyViolations(t, adminTx(t), "", exemptions) {
		t.Error(v)
	}
}

// Test 2 against deliberate violations: testdata/tenancy/tables.sql makes, in a schema of its
// own and in a transaction that is rolled back, tables that break the rule and some that keep
// it, and want.txt is every violation the test must report.
func TestTenantTablesAreIsolatedCatchesEachViolation(t *testing.T) {
	tx := adminTx(t)
	if _, err := tx.Exec(t.Context(), "SET LOCAL ROLE "+db.RoleMigrate); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("testdata", "tenancy")
	execFile(t, tx, dir, "tables.sql")
	got := tenancyViolations(t, tx, "arch_testdata", map[string]exemption{
		"arch_testdata.catalog":          {why: "reference data"},
		"arch_testdata.people":           {why: "global, and the request role deletes and updates its rows"},
		"arch_testdata.tombstoned":       {why: "global, and the request role updates its rows but never deletes one"},
		"arch_testdata.labelled":         {why: "global, and the request role updates a column of its rows the key is not in"},
		"arch_testdata.roots":            {ownPolicy: true, key: "id", why: "a tenant root with a policy of its own"},
		"arch_testdata.roots_unforced":   {ownPolicy: true, key: "id", why: "a tenant root that does not force its policy"},
		"arch_testdata.members":          {ownPolicy: true, why: "read more widely, written in the household"},
		"arch_testdata.members_writable": {ownPolicy: true, why: "written wherever it is read"},
		"arch_testdata.gone":             {why: "a table that has since been dropped"},
	})
	want := lines(t, os.DirFS(dir), "want.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// exemption is why a table is not held to the tenant-table rule.
type exemption struct {
	// ownPolicy marks a table that holds households' rows but is isolated by a policy of its
	// own: it must still enable and force row-level security, have a policy, and be written
	// only in its household's context. A table without it is global, and holds no household's
	// rows.
	ownPolicy bool
	// key is the column that names the household of an own-policy table's row, when it is not
	// household_id: the tenant root's own id.
	key string
	why string
}

// column returns the column that names the household of the table's row.
func (e exemption) column() string {
	if e.key != "" {
		return e.key
	}
	return "household_id"
}

// exemptions are the server's tables that are not tenant tables, each with its reason. An
// exemption that names no table is a violation, so that a renamed table is not exempted by a
// name nothing has.
var exemptions = map[string]exemption{
	"public.goose_db_version": {why: "goose's record of the migrations applied"},
	"public.modules":          {why: "the module ids: reference data, the same for every household"},
	"public.users":            {why: "PRD 01 §2.4: a user exists independently of any household"},
	// PRD 01 §2.4's identity tables, each a user's and none a household's (item 8).
	"public.credentials":              {why: "PRD 01 §2.4: the ways a user signs in"},
	"public.sessions":                 {why: "PRD 01 §2.4: a user's web sessions"},
	"public.email_tokens":             {why: "a user's single-use verification and reset tokens"},
	"public.auth_throttles":           {why: "PRD 02 §9: attempt counts on the sign-in surfaces, keyed by a hash"},
	"public.account_idempotency_keys": {why: "a signed-in user's Idempotency-Keys on routes outside any household"},
	// Item 9's, each a user's too.
	"public.devices":            {why: "PRD 02 §1: the mobile installations a user signs in on"},
	"public.device_sessions":    {why: "a device's sign-in, which holds a refresh-token family (FR-ID4)"},
	"public.refresh_tokens":     {why: "a device sign-in's refresh tokens, kept by their hash"},
	"public.mfa_totp":           {why: "FR-ID5: a user's authenticator, its secret sealed"},
	"public.mfa_recovery_codes": {why: "FR-ID5: a user's recovery codes, kept by their HMAC"},
	"public.mfa_challenges":     {why: "a sign-in waiting for its second step"},
	"public.mfa_trusts":         {why: "a browser or device a user trusted to skip the second step"},
	"public.oauth_states":       {why: "FR-ID2: a sign-in begun with an identity provider"},
	// Item 14's: a user's picture is their account's, and no household's (D-107).
	"public.avatars": {why: "PRD 01 §2.4: a user's picture, kept under their account's prefix and metered to no household"},
	// Item 15's: the platform's jobs, and where a user's browsers and devices are reached and what they
	// want by default, none of which is a household's.
	"public.scheduler_jobs":        {why: "PRD 03 §5: the platform's jobs and when each next falls due"},
	"public.push_subscriptions":    {why: "FR-NT1: a browser's Web Push subscription, its user's while their web session lives"},
	"public.push_receipts":         {why: "FR-NT6: Expo's tickets for a user's device, awaiting their receipts"},
	"public.notification_defaults": {why: "FR-NT2: a user's account-wide notification preferences"},
	// Item 19's: a payer's customer at the payment processor is their account's, whichever households
	// they pay for.
	"public.billing_customers": {why: "PRD 04 §6: a payer's customer at the payment processor, their account's and no household's"},
	// PRD 01 §2.4's global reference data, which the request role only reads (item 7).
	"public.reference_datasets": {why: "the version of each reference dataset the loader has loaded"},
	"public.country_profiles":   {why: "PRD 01 §2.4: reference data, the same for every household"},
	"public.unit_dimensions":    {why: "PRD 03 §9: reference data, the same for every household"},
	"public.units":              {why: "PRD 03 §9: reference data, the same for every household"},
	"public.households": {ownPolicy: true, key: "id", why: "the tenant root, keyed on id; its members read it " +
		"before a household context exists, to list their households"},
	"public.memberships": {ownPolicy: true, why: "PRD 01 §2.4: how tenancy is resolved, read before a " +
		"household context exists, so its policy is keyed on user_id there"},
	"public.invitations": {ownPolicy: true, why: "PRD 01 §2.4: read before a household context exists, by " +
		"the holder of its token and by the verified address it was sent to"},
}

// tenantIsolation is the expression of the policy enable_tenant_isolation creates, both its
// USING and its WITH CHECK, as PostgreSQL prints it back.
const tenantIsolation = "(household_id = app_household_id())"

// isolation is the same expression on the household named by column, the key of an
// own-policy table.
func isolation(column string) string { return "(" + column + " = app_household_id())" }

// table is a relation that can hold rows, as the catalog describes it: whether it is a
// partition, and whether the request role holds any privilege on it.
type table struct {
	oid                  uint32
	name                 string
	kind                 string
	rls, force           bool
	householdCol         string
	partition, reachable bool
}

// policy is a row-level security policy, as the catalog describes it: roles are the roles it
// applies to, by name, "public" for every role.
type policy struct {
	name        string
	permissive  bool
	command     string
	using, with string
	roles       []string
}

// metered reports whether p is the meter role's read (enable_metering): permissive, for reading
// only, to that role alone, over every row. It widens no household's reads, and the role reads
// through it only the columns it is granted, which test 11 holds to what names, counts, sizes or
// schedules rows (PRD 01 §2.3).
func (p policy) metered() bool {
	return p.permissive && p.command == "r" && p.using == "true" && p.with == "" && slices.Equal(p.roles, []string{db.RoleMeter})
}

// foreignKey is a foreign key, as the catalog describes it: the table it references, its
// actions on a delete and on an update there, whether the request role may make either, a
// delete of a row or an update of a column the key references, and its columns, each paired
// with the one it references.
type foreignKey struct {
	name                 string
	references           string
	onDelete, onUpdate   string
	canDelete, canUpdate bool
	columns, referenced  []string
}

// tenancyViolations returns each violation of test 2 in schema, or in every schema that is not
// PostgreSQL's own when schema is "".
func tenancyViolations(t *testing.T, tx pgx.Tx, schema string, exempt map[string]exemption) []string {
	t.Helper()
	ctx := t.Context()
	rows, err := tx.Query(ctx, `
		SELECT c.oid, n.nspname || '.' || c.relname, c.relkind::text, c.relrowsecurity, c.relforcerowsecurity,
		  coalesce((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
		            FROM pg_attribute a
		            WHERE a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped), ''),
		  c.relispartition,
		  has_table_privilege($2::name, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p', 'm')
		  AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
		  AND ($1 = '' OR n.nspname = $1)
		ORDER BY n.nspname, c.relname`, schema, db.RoleApp)
	if err != nil {
		t.Fatal(err)
	}
	tables, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (table, error) {
		var tb table
		err := row.Scan(&tb.oid, &tb.name, &tb.kind, &tb.rls, &tb.force, &tb.householdCol, &tb.partition, &tb.reachable)
		return tb, err
	})
	if err != nil {
		t.Fatal(err)
	}

	rows, err = tx.Query(ctx, `
		SELECT polrelid, polname, polpermissive, polcmd::text,
		  coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), ''),
		  array(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r)::text END FROM unnest(polroles) AS r ORDER BY 1)
		FROM pg_policy
		ORDER BY polrelid, polname`)
	if err != nil {
		t.Fatal(err)
	}
	policies := map[uint32][]policy{}
	var (
		relid uint32
		p     policy
	)
	if _, err := pgx.ForEachRow(rows, []any{&relid, &p.name, &p.permissive, &p.command, &p.using, &p.with, &p.roles}, func() error {
		held := p
		held.roles = slices.Clone(p.roles)
		policies[relid] = append(policies[relid], held)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	rows, err = tx.Query(ctx, `
		SELECT k.conrelid, k.conname, n.nspname || '.' || c.relname, k.confdeltype::text, k.confupdtype::text,
		  has_table_privilege($1::name, k.confrelid, 'DELETE'),
		  EXISTS (SELECT FROM unnest(k.confkey) AS key(attnum)
		          WHERE has_column_privilege($1::name, k.confrelid, key.attnum, 'UPDATE')),
		  array(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY AS key(attnum, i)
		        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = key.attnum ORDER BY key.i),
		  array(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY AS key(attnum, i)
		        JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = key.attnum ORDER BY key.i)
		FROM pg_constraint k
		JOIN pg_class c ON c.oid = k.confrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE k.contype = 'f'
		ORDER BY k.conrelid, k.conname`, db.RoleApp)
	if err != nil {
		t.Fatal(err)
	}
	foreignKeys := map[uint32][]foreignKey{}
	var fk foreignKey
	if _, err := pgx.ForEachRow(rows, []any{
		&relid, &fk.name, &fk.references, &fk.onDelete, &fk.onUpdate, &fk.canDelete, &fk.canUpdate, &fk.columns, &fk.referenced,
	}, func() error {
		key := fk
		key.columns, key.referenced = slices.Clone(fk.columns), slices.Clone(fk.referenced)
		foreignKeys[relid] = append(foreignKeys[relid], key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	var out []string
	seen := map[string]bool{}
	for _, tb := range tables {
		seen[tb.name] = true
		e, exempted := exempt[tb.name]
		switch {
		case exempted && !e.ownPolicy:
			continue
		case exempted:
			out = append(out, rlsViolations(tb)...)
			out = append(out, partitionViolations(tb)...)
			out = append(out, meterNarrowedViolations(tb, policies[tb.oid])...)
			if len(policies[tb.oid]) == 0 {
				out = append(out, tb.name+" has no policy, so the request role reads none of it")
			}
			out = append(out, ownWriteViolations(tb, policies[tb.oid], e.column())...)
			out = append(out, globalActionViolations(tb, foreignKeys[tb.oid], exempt)...)
			out = append(out, householdKeyViolations(tb, foreignKeys[tb.oid], exempt, e.column())...)
			continue
		case tb.kind == "m":
			out = append(out, tb.name+" is a materialized view, which row-level security cannot hold, so it may hold no household's rows")
			continue
		}

		switch tb.householdCol {
		case "":
			out = append(out, tb.name+" has no household_id column")
		case "uuid NOT NULL":
		default:
			out = append(out, fmt.Sprintf("%s.household_id is %s; it must be uuid NOT NULL", tb.name, tb.householdCol))
		}
		out = append(out, rlsViolations(tb)...)
		out = append(out, partitionViolations(tb)...)
		out = append(out, meterNarrowedViolations(tb, policies[tb.oid])...)
		isolated := false
		for _, p := range policies[tb.oid] {
			switch {
			case !p.permissive, p.metered():
			case p.command == "*" && p.using == tenantIsolation && p.with == tenantIsolation && slices.Equal(p.roles, []string{"public"}):
				isolated = true
			default:
				out = append(out, fmt.Sprintf("%s has permissive policy %s, which is not the tenant isolation; "+
					"a narrower rule is a restrictive policy", tb.name, p.name))
			}
		}
		if !isolated {
			out = append(out, tb.name+" has no tenant isolation policy; create it with enable_tenant_isolation")
		}
		out = append(out, globalActionViolations(tb, foreignKeys[tb.oid], exempt)...)
		out = append(out, householdKeyViolations(tb, foreignKeys[tb.oid], exempt, "household_id")...)
	}

	var stale []string
	for name := range exempt {
		if !seen[name] {
			stale = append(stale, name+" is exempted, but no such table exists")
		}
	}
	slices.Sort(stale)
	return append(out, stale...)
}

// ownWriteViolations reports each permissive policy through which a transaction writes an
// own-policy table beyond the household in its context. Only a FOR SELECT policy may be wider
// than the household. A policy that applies to a write is held to the household named by
// column in its USING, which is all a DELETE is checked against, and in its WITH CHECK, or in
// its USING where it has none; an INSERT policy has only a WITH CHECK.
func ownWriteViolations(tb table, policies []policy, column string) []string {
	own := isolation(column)
	var out []string
	for _, p := range policies {
		if !p.permissive || p.command == "r" {
			continue
		}
		check := p.with
		if check == "" {
			check = p.using
		}
		if (p.command != "a" && p.using != own) || check != own {
			out = append(out, fmt.Sprintf("%s has permissive policy %s, which writes beyond the household; "+
				"a wider rule is a FOR SELECT policy", tb.name, p.name))
		}
	}
	return out
}

// householdKeyViolations reports each foreign key from tb, whose rows name their household in
// column, to another table that holds households' rows, which does not pair column with the
// column that names the household there. PostgreSQL checks a foreign key past row-level
// security, so only the pair holds the row a key names to the household of the row that names
// it. A key to a global table is globalActionViolations' concern.
func householdKeyViolations(tb table, fks []foreignKey, exempt map[string]exemption, column string) []string {
	var out []string
	for _, fk := range fks {
		e, exempted := exempt[fk.references]
		if exempted && !e.ownPolicy {
			continue
		}
		paired := false
		for i, c := range fk.columns {
			if c == column && i < len(fk.referenced) && fk.referenced[i] == e.column() {
				paired = true
			}
		}
		if !paired {
			out = append(out, fmt.Sprintf("%s has foreign key %s, which references %s without pairing %s with its %s; "+
				"a foreign key is checked past row-level security, so it can name another household's row",
				tb.name, fk.name, fk.references, column, e.column()))
		}
	}
	return out
}

// globalActionViolations reports each foreign key through which a delete or an update of a
// global table's row, which the request role may make, changes tb's rows: a CASCADE, SET NULL
// or SET DEFAULT action. The action runs past row-level security, so a delete in one
// household's context would reach tb's rows in every household. An update acts only when a
// column the key references changes, so only the request role's privilege on those counts.
func globalActionViolations(tb table, fks []foreignKey, exempt map[string]exemption) []string {
	acts := func(action string) bool { return action == "c" || action == "n" || action == "d" }
	var out []string
	for _, fk := range fks {
		if e, ok := exempt[fk.references]; !ok || e.ownPolicy {
			continue
		}
		if acts(fk.onDelete) && fk.canDelete {
			out = append(out, fmt.Sprintf("%s has foreign key %s, which acts on a delete from %s, a global table the request "+
				"role deletes from; the action runs past row-level security, into every household", tb.name, fk.name, fk.references))
		}
		if acts(fk.onUpdate) && fk.canUpdate {
			out = append(out, fmt.Sprintf("%s has foreign key %s, which acts on an update of %s, a global table the request "+
				"role updates; the action runs past row-level security, into every household", tb.name, fk.name, fk.references))
		}
	}
	return out
}

// meterNarrowedViolations reports each restrictive policy on tb that applies to the meter role, as
// one for every role does. A restrictive policy is ANDed with every permissive one, the meter's read
// among them, so a rule written to narrow what a member reads narrows what the meter counts too: a
// private item's owner, owner_id = app_user_id(), hides every such row from a role that reads with
// no caller, and the usage sample and the fair-use counters would miss them, or bill none of a
// narrowed table's bytes. The meter reads only the columns that name, count, size or schedule rows
// (test 11), so a policy that names the roles it narrows, the request role's, keeps nothing from it
// that a member's rule protects.
func meterNarrowedViolations(tb table, policies []policy) []string {
	var out []string
	for _, p := range policies {
		if !p.permissive && (slices.Contains(p.roles, "public") || slices.Contains(p.roles, db.RoleMeter)) {
			out = append(out, fmt.Sprintf("%s has restrictive policy %s, which narrows the meter role's reads too, so the usage "+
				"sample would miss the rows it hides; name the roles it narrows, TO %s", tb.name, p.name, db.RoleApp))
		}
	}
	return out
}

// partitionViolations reports a partition the request role holds a privilege on.
func partitionViolations(tb table) []string {
	if tb.partition && tb.reachable {
		return []string{tb.name + " is a partition the request role can reach directly; revoke its privileges, " +
			"so that it is reached through its parent, whose privileges and policies hold"}
	}
	return nil
}

// rlsViolations reports a table that does not enable or does not force row-level security.
func rlsViolations(tb table) []string {
	var out []string
	if !tb.rls {
		out = append(out, tb.name+" does not enable row-level security")
	}
	if !tb.force {
		out = append(out, tb.name+" does not force row-level security, so the migrate role, which owns it, bypasses it")
	}
	return out
}
