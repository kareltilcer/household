// Package config reads the server's configuration from the environment. It fails fast
// and names every problem at once: a missing value or a malformed one stops the process
// before it serves anything, because a silently defaulted secret or database is worse
// than a crash.
//
// In development, and only there, the connection strings default to the services
// docker-compose.yml starts, so a fresh clone runs with nothing set. Everywhere else, each
// connection string a command needs must be set explicitly. The other settings, which
// carry no secret and name no database, default everywhere; only the listen address
// differs, loopback in development and :8080 elsewhere. HOUSEHOLD_ENV itself defaults to
// development, so bootstrap, which sets the roles' passwords, sets a defaulted one only on a
// cluster on this machine.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/db"
)

// Env is the deployment environment.
type Env string

// The environments of PRD 01 §9.
const (
	Development Env = "development"
	Staging     Env = "staging"
	Production  Env = "production"
)

// Command is what the process was started to do; each needs different settings.
type Command string

// The commands of cmd/household-api.
const (
	// Serve serves the API as the request role.
	Serve Command = "serve"
	// Migrate applies pending migrations as the migrate role, at deploy time.
	Migrate Command = "migrate"
	// Bootstrap creates the three roles and prepares the database, as an administrator.
	Bootstrap Command = "bootstrap"
)

// Commands lists the commands.
var Commands = []Command{Serve, Migrate, Bootstrap}

// The variables the server reads.
const (
	EnvVar                = "HOUSEHOLD_ENV"
	HTTPAddrVar           = "HOUSEHOLD_HTTP_ADDR"
	DatabaseURLVar        = "HOUSEHOLD_DATABASE_URL"
	MigrateDatabaseURLVar = "HOUSEHOLD_MIGRATE_DATABASE_URL"
	MeterDatabaseURLVar   = "HOUSEHOLD_METER_DATABASE_URL"
	AdminDatabaseURLVar   = "HOUSEHOLD_ADMIN_DATABASE_URL"
	LogLevelVar           = "HOUSEHOLD_LOG_LEVEL"
	ShutdownTimeoutVar    = "HOUSEHOLD_SHUTDOWN_TIMEOUT"
	MaxBodyBytesVar       = "HOUSEHOLD_MAX_BODY_BYTES"
	BodyTimeoutVar        = "HOUSEHOLD_BODY_TIMEOUT"
)

// The development defaults: the compose services, and the role passwords .env.example
// documents. Local-only values, public by design.
//
//nolint:gosec // G101: compose defaults bound to 127.0.0.1, not secrets.
const (
	devDatabaseURL        = "postgres://household_app:household_app@127.0.0.1:5432/household?sslmode=disable"
	devMigrateDatabaseURL = "postgres://household_migrate:household_migrate@127.0.0.1:5432/household?sslmode=disable"
	devMeterDatabaseURL   = "postgres://household_meter:household_meter@127.0.0.1:5432/household?sslmode=disable"
	devAdminDatabaseURL   = "postgres://postgres:postgres@127.0.0.1:5432/household?sslmode=disable"
)

// Config is the validated configuration. A connection string a command does not use is
// empty.
type Config struct {
	Env Env
	// HTTPAddr is where Serve listens.
	HTTPAddr string
	// DatabaseURL connects as the request role.
	DatabaseURL string
	// MigrateDatabaseURL connects as the migrate role.
	MigrateDatabaseURL string
	// MeterDatabaseURL connects as the meter role. Bootstrap sets the role's password from
	// it; the sampler (item 16) connects with it.
	MeterDatabaseURL string
	// AdminDatabaseURL connects as a role that may create roles, for Bootstrap only. The
	// serving process never holds it.
	AdminDatabaseURL string
	LogLevel         slog.Level
	// ShutdownTimeout bounds how long Serve waits for in-flight requests to finish.
	ShutdownTimeout time.Duration
	// MaxBodyBytes caps a JSON request body.
	MaxBodyBytes int64
	// BodyTimeout caps how long a request body may take to arrive. Its default leaves a
	// full-size JSON body a slow mobile connection's time; an upload's handler extends it.
	BodyTimeout time.Duration
}

// Getenv looks a variable up, reporting whether it is set.
type Getenv func(string) (string, bool)

// FromOS is Getenv over the process environment.
func FromOS(key string) (string, bool) { return os.LookupEnv(key) }

// Load reads the configuration command needs.
func Load(command Command, getenv Getenv) (*Config, error) {
	l := &loader{getenv: getenv}
	c := &Config{}

	switch env := Env(l.str(EnvVar, string(Development))); env {
	case Development, Staging, Production:
		c.Env = env
	default:
		l.fail("%s is %q; want development, staging or production", EnvVar, env)
		c.Env = Production // The strictest reading of what follows.
	}
	dev := c.Env == Development

	defaultAddr := ":8080"
	if dev {
		// A developer's machine is not a server: listen where only it can reach.
		defaultAddr = "127.0.0.1:8080"
	}
	c.HTTPAddr = l.str(HTTPAddrVar, defaultAddr)
	c.LogLevel = l.level(LogLevelVar, slog.LevelInfo)
	c.ShutdownTimeout = l.duration(ShutdownTimeoutVar, 20*time.Second)
	c.MaxBodyBytes = l.positive(MaxBodyBytesVar, 1<<20)
	c.BodyTimeout = l.duration(BodyTimeoutVar, 60*time.Second)

	// url reads a connection string command needs, defaulted in development only, and
	// checks that it logs in as role (any role, when role is empty).
	var defaulted []string
	url := func(key, devDefault, role string) string {
		value, ok := l.getenv(key)
		if !ok || value == "" {
			if !dev {
				l.fail("%s is required outside development", key)
				return ""
			}
			value = devDefault
			defaulted = append(defaulted, key)
		}
		cfg, err := pgconn.ParseConfig(value)
		if err != nil {
			l.fail("%s is not a PostgreSQL connection string", key)
			return ""
		}
		if role != "" && cfg.User != role {
			l.fail("%s logs in as %q; it must log in as %s", key, cfg.User, role)
		}
		if role != "" && cfg.Password == "" {
			l.fail("%s carries no password for %s", key, role)
		}
		return value
	}
	switch command {
	case Serve:
		c.DatabaseURL = url(DatabaseURLVar, devDatabaseURL, db.RoleApp)
	case Migrate:
		c.MigrateDatabaseURL = url(MigrateDatabaseURLVar, devMigrateDatabaseURL, db.RoleMigrate)
	case Bootstrap:
		// Bootstrap sets each role's password to the one its connection string carries, so
		// the strings the other commands use are the only place a password is written down.
		c.DatabaseURL = url(DatabaseURLVar, devDatabaseURL, db.RoleApp)
		c.MigrateDatabaseURL = url(MigrateDatabaseURLVar, devMigrateDatabaseURL, db.RoleMigrate)
		c.MeterDatabaseURL = url(MeterDatabaseURLVar, devMeterDatabaseURL, db.RoleMeter)
		c.AdminDatabaseURL = url(AdminDatabaseURLVar, devAdminDatabaseURL, "")
		l.sameDatabase(c.DatabaseURL, c.MigrateDatabaseURL, c.MeterDatabaseURL)
		l.localDefaults(defaulted, c.AdminDatabaseURL)
	default:
		l.fail("unknown command %q", command)
	}

	if len(l.errs) > 0 {
		return nil, fmt.Errorf("config: %w", errors.Join(l.errs...))
	}
	return c, nil
}

// Database returns the name of the database a connection string connects to.
func Database(url string) (string, error) {
	cfg, err := pgconn.ParseConfig(url)
	if err != nil {
		return "", err
	}
	return cfg.Database, nil
}

// Password returns the password a connection string carries.
func Password(url string) (string, error) {
	cfg, err := pgconn.ParseConfig(url)
	if err != nil {
		return "", err
	}
	return cfg.Password, nil
}

type loader struct {
	getenv Getenv
	errs   []error
}

func (l *loader) fail(format string, args ...any) {
	l.errs = append(l.errs, fmt.Errorf(format, args...))
}

func (l *loader) str(key, def string) string {
	if v, ok := l.getenv(key); ok && v != "" {
		return v
	}
	return def
}

func (l *loader) level(key string, def slog.Level) slog.Level {
	v, ok := l.getenv(key)
	if !ok || v == "" {
		return def
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToUpper(v))); err != nil {
		l.fail("%s is %q; want debug, info, warn or error", key, v)
		return def
	}
	return level
}

func (l *loader) duration(key string, def time.Duration) time.Duration {
	v, ok := l.getenv(key)
	if !ok || v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		l.fail("%s is %q; want a positive duration such as 20s", key, v)
		return def
	}
	return d
}

func (l *loader) positive(key string, def int64) int64 {
	v, ok := l.getenv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		l.fail("%s is %q; want a positive number of bytes", key, v)
		return def
	}
	return n
}

// localDefaults refuses a development default among the connection strings Bootstrap reads
// when the administrator's names a cluster off this machine. Bootstrap sets each role's
// password to the one its string carries, and a default carries the one .env.example
// publishes, which would leave that role open to anyone on a remote cluster. HOUSEHOLD_ENV
// itself defaults to development, so a deploy that forgets it is stopped here rather than
// by a crash that never comes.
func (l *loader) localDefaults(defaulted []string, adminURL string) {
	if len(defaulted) == 0 || adminURL == "" || local(adminURL) {
		return
	}
	l.fail("%s not set, and a development default carries a published password, which bootstrap sets only on a cluster on this machine; %s names another",
		strings.Join(defaulted, ", "), AdminDatabaseURLVar)
}

// local reports whether a connection string reaches PostgreSQL on this machine only, over
// loopback or a Unix socket, at every host it names.
func local(url string) bool {
	cfg, err := pgconn.ParseConfig(url)
	if err != nil {
		return false
	}
	hosts := []string{cfg.Host}
	for _, fallback := range cfg.Fallbacks {
		hosts = append(hosts, fallback.Host)
	}
	for _, host := range hosts {
		if ip := net.ParseIP(host); host != "localhost" && !strings.HasPrefix(host, "/") && (ip == nil || !ip.IsLoopback()) {
			return false
		}
	}
	return true
}

// sameDatabase checks the role connection strings Bootstrap reads all name one database,
// the one it prepares.
func (l *loader) sameDatabase(urls ...string) {
	var first string
	for i, u := range urls {
		if u == "" {
			return
		}
		name, err := Database(u)
		if err != nil {
			return
		}
		if i == 0 {
			first = name
			continue
		}
		if name != first {
			l.fail("the role connection strings name different databases, %q and %q", first, name)
			return
		}
	}
}
