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

	c, err := config.Load(config.Serve, env(map[string]string{
		config.EnvVar:         "production",
		config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.HTTPAddr != ":8080" {
		t.Errorf("production listens on %q, want :8080", c.HTTPAddr)
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
