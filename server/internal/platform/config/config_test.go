package config_test

import (
	"log/slog"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/config"
)

func env(vars map[string]string) config.Getenv {
	return func(key string) (string, bool) {
		v, ok := vars[key]
		return v, ok
	}
}

func TestDevelopmentNeedsNothingSet(t *testing.T) {
	for _, command := range config.Commands {
		c, err := config.Load(command, env(nil))
		if err != nil {
			t.Fatalf("%s: %v", command, err)
		}
		if c.Env != config.Development || c.HTTPAddr != "127.0.0.1:8080" || c.LogLevel != slog.LevelInfo ||
			c.ShutdownTimeout != 20*time.Second || c.MaxBodyBytes != 1<<20 || c.BodyTimeout != time.Minute {
			t.Fatalf("%s: %+v", command, c)
		}
	}
}

// The serving process gets the request role's connection and nothing else: never the
// administrator's, which only bootstrap holds.
func TestEachCommandGetsOnlyTheConnectionsItUses(t *testing.T) {
	serve, _ := config.Load(config.Serve, env(nil))
	if serve.DatabaseURL == "" || serve.MigrateDatabaseURL != "" || serve.AdminDatabaseURL != "" || serve.MeterDatabaseURL != "" {
		t.Errorf("serve: %+v", serve)
	}
	migrate, _ := config.Load(config.Migrate, env(nil))
	if migrate.MigrateDatabaseURL == "" || migrate.DatabaseURL != "" || migrate.AdminDatabaseURL != "" {
		t.Errorf("migrate: %+v", migrate)
	}
	bootstrap, _ := config.Load(config.Bootstrap, env(nil))
	if bootstrap.AdminDatabaseURL == "" || bootstrap.DatabaseURL == "" || bootstrap.MigrateDatabaseURL == "" || bootstrap.MeterDatabaseURL == "" {
		t.Errorf("bootstrap: %+v", bootstrap)
	}
}

func TestOutsideDevelopmentNothingIsDefaulted(t *testing.T) {
	for _, e := range []string{"staging", "production"} {
		_, err := config.Load(config.Bootstrap, env(map[string]string{config.EnvVar: e}))
		if err == nil {
			t.Fatalf("%s: loaded with no connection strings", e)
		}
		for _, key := range []string{config.DatabaseURLVar, config.MigrateDatabaseURLVar, config.MeterDatabaseURLVar, config.AdminDatabaseURLVar} {
			if !strings.Contains(err.Error(), key) {
				t.Errorf("%s: the error does not name %s: %v", e, key, err)
			}
		}
	}

	_, err := config.Load(config.Serve, env(map[string]string{
		config.EnvVar:         "production",
		config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
	}))
	for _, key := range []string{config.WebURLVar, config.TrustedProxiesVar, config.SMTPURLVar, config.MailFromVar, config.BreachedPasswordsVar} {
		if err == nil || !strings.Contains(err.Error(), key) {
			t.Errorf("serving in production without %s: %v", key, err)
		}
	}

	c, err := config.Load(config.Serve, env(serving(map[string]string{
		config.EnvVar:         "production",
		config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
	})))
	if err != nil {
		t.Fatal(err)
	}
	if c.HTTPAddr != ":8080" || len(c.TrustedProxies) != 0 {
		t.Errorf("production listens on %q, want :8080, behind %v, want no proxy", c.HTTPAddr, c.TrustedProxies)
	}
}

// serving adds to vars what serving needs outside development, where vars does not set it.
func serving(vars map[string]string) map[string]string {
	for key, value := range map[string]string{
		config.WebURLVar:            "https://app.household.example",
		config.TrustedProxiesVar:    config.NoProxies,
		config.SMTPURLVar:           "smtps://mailer:" + "pw" + "@smtp.example:465",
		config.MailFromVar:          "Household <no-reply@household.example>",
		config.BreachedPasswordsVar: "/var/lib/household/breached.bin",
	} {
		if _, ok := vars[key]; !ok {
			vars[key] = value
		}
	}
	return vars
}

// In development the account settings default to the web client's dev server and the compose mail
// catcher, and the breached-password screen may be off.
func TestServingInDevelopmentDefaultsTheAccountSettings(t *testing.T) {
	c, err := config.Load(config.Serve, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.WebURL.String() != "http://localhost:5173" || c.SMTPURL != "smtp://127.0.0.1:1025" ||
		c.MailFrom != "Household <no-reply@household.localhost>" || c.BreachedPasswords != "" ||
		len(c.TrustedProxies) != 0 || strings.Join(c.AllowedOrigins, ",") != "http://localhost:5173" {
		t.Fatalf("%+v", c)
	}
}

func TestTheAccountSettingsAreRead(t *testing.T) {
	c, err := config.Load(config.Serve, env(serving(map[string]string{
		config.AllowedOriginsVar: "https://preview.household.example, http://localhost:5173",
		config.TrustedProxiesVar: "10.0.0.0/8,192.168.1.1",
	})))
	if err != nil {
		t.Fatal(err)
	}
	if c.WebURL.String() != "https://app.household.example" || c.BreachedPasswords != "/var/lib/household/breached.bin" ||
		strings.Join(c.AllowedOrigins, ",") != "https://app.household.example,https://preview.household.example,http://localhost:5173" ||
		len(c.TrustedProxies) != 2 {
		t.Fatalf("%+v", c)
	}
}

// Each malformed account setting is named, and the mail server's URL, which carries its password,
// never appears in an error.
func TestMalformedAccountSettingsAreReported(t *testing.T) {
	_, err := config.Load(config.Serve, env(map[string]string{
		config.WebURLVar:         "app.household.example",
		config.AllowedOriginsVar: "https://ok.example, ftp://files.example",
		config.TrustedProxiesVar: "10.0.0.0/8, somewhere",
		config.SMTPURLVar:        "imap://mailer:" + "hunter2" + "@smtp.example:993",
	}))
	if err == nil {
		t.Fatal("loaded")
	}
	for _, key := range []string{config.WebURLVar, config.AllowedOriginsVar, config.TrustedProxiesVar, config.SMTPURLVar} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("the error does not name %s: %v", key, err)
		}
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Errorf("the error quotes the mail server's password: %v", err)
	}
}

// Serving as any role but the request role would serve with that role's privileges; as a
// superuser or the table owner, past row-level security.
func TestEachConnectionMustLogInAsItsRole(t *testing.T) {
	// pgconn fills a missing password from these, which a developer's machine may set.
	t.Setenv("PGPASSWORD", "")
	t.Setenv("PGPASSFILE", t.TempDir()+"/none")
	for name, tc := range map[string]struct {
		command config.Command
		vars    map[string]string
		want    string
	}{
		"serve as a superuser": {config.Serve, map[string]string{config.DatabaseURLVar: dsn("postgres", "postgres", "127.0.0.1", "household")}, "must log in as household_app"},
		"serve as the owner":   {config.Serve, map[string]string{config.DatabaseURLVar: dsn("household_migrate", "x", "127.0.0.1", "household")}, "must log in as household_app"},
		"migrate as the app":   {config.Migrate, map[string]string{config.MigrateDatabaseURLVar: dsn("household_app", "x", "127.0.0.1", "household")}, "must log in as household_migrate"},
		"no password":          {config.Serve, map[string]string{config.DatabaseURLVar: dsn("household_app", "", "127.0.0.1", "household")}, "carries no password"},
		"not a URL":            {config.Serve, map[string]string{config.DatabaseURLVar: "postgres://%zz"}, "not a PostgreSQL connection string"},
		"different databases":  {config.Bootstrap, map[string]string{config.MeterDatabaseURLVar: dsn("household_meter", "x", "127.0.0.1", "other")}, "different databases"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := config.Load(tc.command, env(tc.vars))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %v, want one containing %q", err, tc.want)
			}
		})
	}
}

// Bootstrap sets each role's password to the one its connection string carries, and a
// development default carries the one .env.example publishes. A deploy that forgets
// HOUSEHOLD_ENV runs as development, so bootstrap takes a defaulted password only for a
// cluster on this machine, and never leaves a remote role open with a published one.
func TestADefaultedPasswordIsSetOnlyOnALocalCluster(t *testing.T) {
	remote := map[string]string{
		config.AdminDatabaseURLVar:   dsn("postgres", "s3cret", "db.internal:5432", "household"),
		config.DatabaseURLVar:        dsn("household_app", "a", "db.internal:5432", "household"),
		config.MigrateDatabaseURLVar: dsn("household_migrate", "m", "db.internal:5432", "household"),
	}
	_, err := config.Load(config.Bootstrap, env(remote))
	if err == nil || !strings.Contains(err.Error(), config.MeterDatabaseURLVar) {
		t.Fatalf("a remote cluster with the meter's password defaulted: %v", err)
	}

	remote[config.MeterDatabaseURLVar] = dsn("household_meter", "r", "db.internal:5432", "household")
	if _, err := config.Load(config.Bootstrap, env(remote)); err != nil {
		t.Fatalf("a remote cluster with every string set: %v", err)
	}
	for _, host := range []string{"localhost:5432", "127.0.0.1:5433", "[::1]:5432"} {
		local := map[string]string{config.AdminDatabaseURLVar: dsn("postgres", "postgres", host, "household")}
		if _, err := config.Load(config.Bootstrap, env(local)); err != nil {
			t.Errorf("a cluster at %s with the roles' strings defaulted: %v", host, err)
		}
	}
}

func TestMalformedValuesAreAllReported(t *testing.T) {
	_, err := config.Load(config.Serve, env(map[string]string{
		config.EnvVar:             "prod",
		config.LogLevelVar:        "loud",
		config.ShutdownTimeoutVar: "-5s",
		config.MaxBodyBytesVar:    "a lot",
		config.BodyTimeoutVar:     "forever",
	}))
	if err == nil {
		t.Fatal("loaded")
	}
	for _, key := range []string{config.EnvVar, config.LogLevelVar, config.ShutdownTimeoutVar, config.MaxBodyBytesVar, config.BodyTimeoutVar, config.DatabaseURLVar} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("the error does not name %s: %v", key, err)
		}
	}
}

func TestValuesAreRead(t *testing.T) {
	c, err := config.Load(config.Serve, env(map[string]string{
		config.HTTPAddrVar:        ":9090",
		config.LogLevelVar:        "debug",
		config.ShutdownTimeoutVar: "3s",
		config.MaxBodyBytesVar:    "2048",
		config.BodyTimeoutVar:     "90s",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.HTTPAddr != ":9090" || c.LogLevel != slog.LevelDebug || c.ShutdownTimeout != 3*time.Second || c.MaxBodyBytes != 2048 ||
		c.BodyTimeout != 90*time.Second {
		t.Fatalf("%+v", c)
	}
}

func TestUnknownCommand(t *testing.T) {
	if _, err := config.Load("seed", env(nil)); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("%v", err)
	}
}

func TestDatabaseAndPassword(t *testing.T) {
	conn := dsn("household_app", "pa@ss", "127.0.0.1:5432", "household")
	if name, err := config.Database(conn); err != nil || name != "household" {
		t.Errorf("Database = %q, %v", name, err)
	}
	if pw, err := config.Password(conn); err != nil || pw != "pa@ss" {
		t.Errorf("Password = %q, %v", pw, err)
	}
}

// dsn builds a connection string, so that no test literal looks like a leaked credential.
func dsn(user, password, host, database string) string {
	u := url.URL{Scheme: "postgres", Host: host, Path: "/" + database}
	if password == "" {
		u.User = url.User(user)
	} else {
		u.User = url.UserPassword(user, password)
	}
	return u.String()
}
