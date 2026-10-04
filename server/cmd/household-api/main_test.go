package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/breach"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// env is the environment of a deployed process pointed at this package's database, with an
// empty breached-password corpus and a mail server nothing answers at, since serving sends none.
func env(t *testing.T) config.Getenv {
	d := testsupport.Open(t)
	corpus := filepath.Join(t.TempDir(), "breached.bin")
	w, err := breach.Create(corpus)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	vars := map[string]string{
		config.EnvVar:                "staging",
		config.HTTPAddrVar:           "127.0.0.1:0",
		config.DatabaseURLVar:        d.URL(db.RoleApp),
		config.MigrateDatabaseURLVar: d.URL(db.RoleMigrate),
		config.MeterDatabaseURLVar:   d.URL(db.RoleMeter),
		config.StaffDatabaseURLVar:   d.URL(db.RoleStaff),
		config.AdminDatabaseURLVar:   testsupport.AdminURL(),
		// PowerSync's replication role; its bucket storage, unnamed outside development, is left be.
		config.ReplicationDatabaseURLVar: d.URL(db.RolePowerSync),
		config.PowerSyncURLVar:           "https://powersync.household.test",
		config.WebURLVar:                 "https://app.household.test",
		config.TrustedProxiesVar:         config.NoProxies,
		config.SMTPURLVar:                "smtp://127.0.0.1:1",
		config.MailFromVar:               "Household <no-reply@household.test>",
		config.BreachCorpusVar:           corpus,
		config.TokenKeysVar:              base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		config.MFAKeysVar:                base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)),
		// The notification transport's keys, which serving holds before any notification is sent.
		config.NotifyKeysVar: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)),
		config.VAPIDKeyVar:   base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32)),
		// The files pipeline's store and converter, which serving asks nothing of until a file comes
		// but readiness, which finds no store there and answers degraded.
		config.ObjectStoreURLVar: "https://tester:" + "not-published" + "@objects.household.test/household",
		config.ConverterURLVar:   "http://127.0.0.1:1",
		config.UploadDirVar:      t.TempDir(),
		// Billing's payment processor, in test mode as staging's is, which serving asks nothing of
		// until an owner subscribes, and a price for each of the plan's three.
		config.StripeSecretKeyVar:      "sk_" + "test_key",
		config.StripePublishableKeyVar: "pk_" + "test_key",
		config.StripeWebhookSecretVar:  "whsec_" + "key",
		config.BillingPricesVar: `{"EUR": {"year": {"amount_minor": 5988, "price": "price_year"},
			"month": {"amount_minor": 599, "price": "price_month"}, "block": {"amount_minor": 100, "price": "price_block"}}}`,
	}
	return func(key string) (string, bool) {
		v, ok := vars[key]
		return v, ok
	}
}

func TestUsageErrorsExit2(t *testing.T) {
	var stderr bytes.Buffer
	if code := run(t.Context(), []string{"serve", "extra"}, env(t), io.Discard, &stderr); code != 2 {
		t.Errorf("two arguments: exit %d", code)
	}
	if code := run(t.Context(), []string{"seed"}, env(t), io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), "unknown command") {
		t.Errorf("an unknown command: exit %d, %s", code, stderr.String())
	}
	stderr.Reset()
	noDatabase := func(key string) (string, bool) {
		if key == config.EnvVar {
			return "production", true
		}
		return "", false
	}
	if code := run(t.Context(), nil, noDatabase, io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), config.DatabaseURLVar) {
		t.Errorf("production with no database: exit %d, %s", code, stderr.String())
	}
}

// The staff command makes an account one of the platform's staff, or takes it out of them, as the
// operator: how the first platform_admin is made (runbooks/platform-staff.md). The account is one
// with a verified address, the change is in the platform's log as the operator's, and the last
// platform_admin keeps the role.
func TestTheStaffCommandMakesAndUnmakesStaff(t *testing.T) {
	ctx := t.Context()
	for _, args := range [][]string{{"staff"}, {"staff", "grant", "karel@household.test"}, {"staff", "grant", "karel@household.test", "owner"},
		{"staff", "revoke"}, {"staff", "promote", "karel@household.test", "support"}} {
		var stderr bytes.Buffer
		if code := run(ctx, args, env(t), io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), "staff grant <email>") {
			t.Errorf("%v: exit %d, %s", args, code, stderr.String())
		}
	}

	admin, err := pgx.Connect(ctx, testsupport.Open(t).URL(""))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	for _, stmt := range []string{
		"INSERT INTO users (id, email, email_verified_at) VALUES ('01900000-0000-7000-8000-00000000c0a1', 'karel@household.test', now())",
		"INSERT INTO users (id, email) VALUES ('01900000-0000-7000-8000-00000000c0a2', 'unverified@household.test')",
	} {
		if _, err := admin.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	staffed := func(email string) (role string) {
		t.Helper()
		if err := admin.QueryRow(ctx, `SELECT coalesce((SELECT s.role::text FROM platform.staff s JOIN users u ON u.id = s.user_id
			WHERE u.email = $1), '')`, email).Scan(&role); err != nil {
			t.Fatal(err)
		}
		return role
	}

	// An address nobody has, and one that is not verified, are not made staff.
	for _, email := range []string{"nobody@household.test", "unverified@household.test"} {
		if code := run(ctx, []string{"staff", "grant", email, "support"}, env(t), io.Discard, io.Discard); code != 1 || staffed(email) != "" {
			t.Errorf("%s: exit %d, staff %q", email, code, staffed(email))
		}
	}
	// The command says what it did: taking out an account that is not staff changes nothing, and is
	// said to, so that an address mistaken for a staff member's does not read as one taken out.
	said := func(args ...string) string {
		t.Helper()
		var stdout bytes.Buffer
		if code := run(ctx, args, env(t), &stdout, io.Discard); code != 0 {
			t.Fatalf("%v: exit %d, %s", args, code, stdout.String())
		}
		return stdout.String()
	}
	if out := said("staff", "revoke", "karel@household.test"); !strings.Contains(out, "nothing changed") {
		t.Errorf("revoking an account that is not staff: %s", out)
	}
	if out := said("staff", "grant", "Karel@household.test", "support"); staffed("karel@household.test") != "support" ||
		!strings.Contains(out, "made one of the platform's staff") {
		t.Fatalf("grant: staff %q, %s", staffed("karel@household.test"), out)
	}
	if out := said("staff", "grant", "karel@household.test", "support"); !strings.Contains(out, "nothing changed") {
		t.Errorf("granting the role an account holds already: %s", out)
	}
	if code := run(ctx, []string{"staff", "grant", "karel@household.test", "platform_admin"}, env(t), io.Discard, io.Discard); code != 0 ||
		staffed("karel@household.test") != "platform_admin" {
		t.Fatalf("a role changed: exit %d, staff %q", code, staffed("karel@household.test"))
	}
	// The last platform_admin keeps the role: nobody could make another through the API.
	if code := run(ctx, []string{"staff", "revoke", "karel@household.test"}, env(t), io.Discard, io.Discard); code != 1 ||
		staffed("karel@household.test") != "platform_admin" {
		t.Fatalf("the last platform_admin revoked: exit %d, staff %q", code, staffed("karel@household.test"))
	}
	if code := run(ctx, []string{"staff", "grant", "karel@household.test", "support"}, env(t), io.Discard, io.Discard); code != 1 {
		t.Fatalf("the last platform_admin made support: exit %d", code)
	}
	var entries int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM platform.audit_log
		WHERE action = 'staff.grant' AND actor_id IS NULL AND actor_label = 'operator' AND actor_role IS NULL
		  AND target_user_id = '01900000-0000-7000-8000-00000000c0a1'`).Scan(&entries); err != nil {
		t.Fatal(err)
	}
	if entries != 2 {
		t.Fatalf("%d entries of the operator's in the platform's log, want the two grants", entries)
	}
}

func TestBootstrapThenMigrate(t *testing.T) {
	var stdout bytes.Buffer
	if code := run(t.Context(), []string{"bootstrap"}, env(t), &stdout, io.Discard); code != 0 {
		t.Fatalf("bootstrap: exit %d\n%s", code, stdout.String())
	}
	if code := run(t.Context(), []string{"migrate"}, env(t), &stdout, io.Discard); code != 0 {
		t.Fatalf("migrate: exit %d\n%s", code, stdout.String())
	}
	if !strings.Contains(stdout.String(), `"msg":"migrations up to date"`) {
		t.Fatalf("migrate did not report:\n%s", stdout.String())
	}
	// The package's database holds the reference data already, so the load writes nothing.
	for _, dataset := range []string{"countries", "units"} {
		line := `"msg":"reference data loaded","dataset":"` + dataset + `","version":1,"inserted":0,"updated":0,"kept":0`
		if !strings.Contains(stdout.String(), line) {
			t.Fatalf("migrate did not report loading %s:\n%s", dataset, stdout.String())
		}
	}
}

func TestAFailingCommandExits1(t *testing.T) {
	u, err := url.Parse(testsupport.Open(t).URL(db.RoleMigrate))
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(db.RoleMigrate, "wrong")
	wrong := func(key string) (string, bool) {
		if key == config.MigrateDatabaseURLVar {
			return u.String(), true
		}
		return env(t)(key)
	}
	var stdout bytes.Buffer
	if code := run(t.Context(), []string{"migrate"}, wrong, &stdout, io.Discard); code != 1 {
		t.Fatalf("migrate with a wrong password: exit %d", code)
	}
	if !strings.Contains(stdout.String(), `"msg":"command failed"`) {
		t.Fatalf("the failure was not logged:\n%s", stdout.String())
	}
}

func TestServeAnswersUntilItsContextEnds(t *testing.T) {
	cfg, err := config.Load(config.Serve, env(t))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	listening := make(chan net.Addr, 1)
	served := make(chan error, 1)
	go func() { served <- serve(ctx, cfg, logging.New(io.Discard, slog.LevelInfo), listening) }()

	var addr net.Addr
	select {
	case addr = <-listening:
	case err := <-served:
		t.Fatalf("serve: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("serve did not start listening")
	}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+addr.String()+"/api/v1/readyz", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	// The object store is checked too, and one that cannot be reached degrades the answer without
	// failing it: the API serves everything but uploads without it (FR-NF3).
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"database":"ok"`) ||
		!strings.Contains(string(body), `"object_store":"down"`) || !strings.Contains(string(body), `"status":"degraded"`) {
		t.Fatalf("readyz: %d %s", resp.StatusCode, body)
	}

	cancel()
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("serve: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("serve did not stop")
	}
}
