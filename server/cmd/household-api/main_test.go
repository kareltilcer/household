package main

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
		config.AdminDatabaseURLVar:   testsupport.AdminURL(),
		config.WebURLVar:             "https://app.household.test",
		config.TrustedProxiesVar:     config.NoProxies,
		config.SMTPURLVar:            "smtp://127.0.0.1:1",
		config.MailFromVar:           "Household <no-reply@household.test>",
		config.BreachedPasswordsVar:  corpus,
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
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"database":"ok"`) {
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
