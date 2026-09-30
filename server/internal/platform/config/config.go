// Package config reads the server's configuration from the environment. It fails fast
// and names every problem at once: a missing value or a malformed one stops the process
// before it serves anything, because a silently defaulted secret or database is worse
// than a crash.
//
// In development, and only there, the connection strings default to the services
// docker-compose.yml starts, so a fresh clone runs with nothing set. Everywhere else, each
// connection string a command needs must be set explicitly, and so must what serving the
// accounts needs: where the web client is, the proxies in front of the server (or none), the
// mail server and its sender, the breached-password corpus, which development may run without,
// the keys that sign access tokens and seal the second step's secrets, which development
// defaults to published ones, and the object store and the converter sidecar the files pipeline
// uses, which development defaults to the compose services. Google and Apple are each configured whole or not at all. The other settings, which carry no secret and name no database, default
// everywhere; only the listen address differs, loopback in development and :8080 elsewhere.
// HOUSEHOLD_ENV itself defaults to development, so bootstrap, which sets the roles'
// passwords, sets a defaulted one only on a cluster on this machine.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/mfa"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/token"
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
	WebURLVar             = "HOUSEHOLD_WEB_URL"
	AllowedOriginsVar     = "HOUSEHOLD_ALLOWED_ORIGINS"
	TrustedProxiesVar     = "HOUSEHOLD_TRUSTED_PROXIES"
	SMTPURLVar            = "HOUSEHOLD_SMTP_URL"
	MailFromVar           = "HOUSEHOLD_MAIL_FROM"
	BreachCorpusVar       = "HOUSEHOLD_BREACH_CORPUS"
	TokenKeysVar          = "HOUSEHOLD_TOKEN_KEYS"
	MFAKeysVar            = "HOUSEHOLD_MFA_KEYS"
	MinMobileVersionVar   = "HOUSEHOLD_MIN_MOBILE_VERSION"
	MinWebVersionVar      = "HOUSEHOLD_MIN_WEB_VERSION"
	RedirectURIsVar       = "HOUSEHOLD_OAUTH_REDIRECT_URIS"
	GoogleClientIDVar     = "HOUSEHOLD_GOOGLE_CLIENT_ID"
	GoogleClientSecretVar = "HOUSEHOLD_GOOGLE_CLIENT_SECRET"
	AppleClientIDVar      = "HOUSEHOLD_APPLE_CLIENT_ID"
	AppleTeamIDVar        = "HOUSEHOLD_APPLE_TEAM_ID"
	AppleKeyIDVar         = "HOUSEHOLD_APPLE_KEY_ID"
	ApplePrivateKeyVar    = "HOUSEHOLD_APPLE_PRIVATE_KEY"

	ReplicationDatabaseURLVar = "HOUSEHOLD_REPLICATION_DATABASE_URL"
	PowerSyncStorageURLVar    = "HOUSEHOLD_POWERSYNC_STORAGE_URL"
	PowerSyncURLVar           = "HOUSEHOLD_POWERSYNC_URL"

	ObjectStoreURLVar       = "HOUSEHOLD_OBJECT_STORE_URL"
	ObjectStorePublicURLVar = "HOUSEHOLD_OBJECT_STORE_PUBLIC_URL"
	ConverterURLVar         = "HOUSEHOLD_CONVERTER_URL"
	UploadDirVar            = "HOUSEHOLD_UPLOAD_DIR"
	UploadTimeoutVar        = "HOUSEHOLD_UPLOAD_TIMEOUT"
)

// NoProxies is TrustedProxiesVar's value for a server its clients reach directly, with no proxy
// in front of it: outside development the variable must name the proxies or say this.
const NoProxies = "none"

// The development defaults: the compose services, and the role passwords .env.example
// documents. Local-only values, public by design.
//
//nolint:gosec // G101: compose defaults bound to 127.0.0.1, not secrets.
const (
	devDatabaseURL        = "postgres://household_app:household_app@127.0.0.1:5432/household?sslmode=disable"
	devMigrateDatabaseURL = "postgres://household_migrate:household_migrate@127.0.0.1:5432/household?sslmode=disable"
	devMeterDatabaseURL   = "postgres://household_meter:household_meter@127.0.0.1:5432/household?sslmode=disable"
	devAdminDatabaseURL   = "postgres://postgres:postgres@127.0.0.1:5432/household?sslmode=disable"
	// PowerSync's (ADR 0001): the role it replicates as, its bucket storage, and where a client
	// reaches the service docker-compose.yml runs.
	devReplicationDatabaseURL = "postgres://household_powersync:household_powersync@127.0.0.1:5432/household?sslmode=disable"
	devPowerSyncStorageURL    = "postgres://household_powersync_storage:household_powersync_storage@127.0.0.1:5432/powersync_storage?sslmode=disable"
	devPowerSyncURL           = "http://127.0.0.1:8081"
	// The web client's dev server, and the compose mail catcher, which keeps every message.
	devWebURL   = "http://localhost:5173"
	devSMTPURL  = "smtp://127.0.0.1:1025"
	devMailFrom = "Household <no-reply@household.localhost>"
	// The compose object store, with its bucket, and the converter sidecar of its convert profile.
	devObjectStoreURL = "http://household:" + devObjectStoreSecret + "@127.0.0.1:9000/household"
	devConverterURL   = "http://127.0.0.1:3100"
)

// devObjectStoreSecret is the compose object store's published secret, which nothing outside
// development may use.
const devObjectStoreSecret = "household-local-only"

// The keys development signs access tokens and seals the second step's secrets with: 32 published
// bytes each, in base64, which nothing outside development may use.
var (
	devTokenKeys = base64.StdEncoding.EncodeToString([]byte("household development access key"))
	devMFAKeys   = base64.StdEncoding.EncodeToString([]byte("household development mfa secret"))
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
	// it; Serve reads across households with it, the usage sampler and the files workers (item 14).
	MeterDatabaseURL string
	// AdminDatabaseURL connects as a role that may create roles, for Bootstrap only. The
	// serving process never holds it.
	AdminDatabaseURL string
	// ReplicationDatabaseURL connects as the role PowerSync replicates as (db.RolePowerSync).
	// Bootstrap sets the role's password from it; PowerSync's own configuration connects with it,
	// and the server never does.
	ReplicationDatabaseURL string
	// PowerSyncStorageURL is PowerSync's bucket storage (db.Storage): its role and its database,
	// which Bootstrap prepares on the administrator's cluster, "" when it is kept elsewhere and
	// Bootstrap leaves it be.
	PowerSyncStorageURL string
	// PowerSyncURL is where a client reaches PowerSync, which its sync credentials name.
	PowerSyncURL string
	LogLevel     slog.Level
	// ShutdownTimeout bounds how long Serve waits for in-flight requests to finish.
	ShutdownTimeout time.Duration
	// MaxBodyBytes caps a JSON request body.
	MaxBodyBytes int64
	// BodyTimeout caps how long a request body may take to arrive. Its default leaves a
	// full-size JSON body a slow mobile connection's time; an upload's handler extends it.
	BodyTimeout time.Duration

	// WebURL is where the web client is served, which the emails link to: https outside
	// development. Its origin is always allowed.
	WebURL *url.URL
	// AllowedOrigins are the origins an unsafe request from a browser may come from: WebURL's,
	// and any HOUSEHOLD_ALLOWED_ORIGINS adds.
	AllowedOrigins []string
	// TrustedProxies are the proxies whose X-Forwarded-For names the client (clientip), none when
	// HOUSEHOLD_TRUSTED_PROXIES is NoProxies, as development defaults it.
	TrustedProxies []netip.Prefix
	// SMTPURL is the mail server, smtp:// or smtps://, with its credentials; MailFrom the sender.
	SMTPURL, MailFrom string
	// BreachCorpus is the path of the breached-password corpus file (internal/platform/breach),
	// "" for none, which only development may serve with.
	BreachCorpus string
	// TokenKeys sign and verify access tokens (internal/platform/token), the first signing.
	TokenKeys *token.Keys
	// MFAKeys seal the second step's secrets (internal/platform/mfa), the first sealing.
	MFAKeys *mfa.Keys
	// MinClients are the oldest client of each type served (internal/platform/clientversion).
	MinClients clientversion.Minimums
	// RedirectURIs are those a provider may send a person back to; Google and Apple are the
	// providers configured, nil for one that is not.
	RedirectURIs  []string
	Google, Apple *federation.Config

	// ObjectStore is the bucket the files pipeline keeps households' files and users' pictures in
	// (item 14), and ObjectStorePublic the scheme and host a client reaches it at, which the links the
	// API pre-signs name: nil for the endpoint the server reaches it at.
	ObjectStore       objectstore.Location
	ObjectStorePublic *url.URL
	// ConverterURL is the converter sidecar (cmd/converter), which derives an office document's
	// and a PDF's variants.
	ConverterURL string
	// UploadDir is where uploads are read to before they are stored, a directory of the system's
	// temporary one when "", and UploadTimeout how long an upload's body may take to arrive.
	UploadDir     string
	UploadTimeout time.Duration
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
		c.MeterDatabaseURL = url(MeterDatabaseURLVar, devMeterDatabaseURL, db.RoleMeter)
		l.sameDatabase(c.DatabaseURL, c.MeterDatabaseURL)
		l.serving(c, dev)
		l.files(c, dev)
	case Migrate:
		c.MigrateDatabaseURL = url(MigrateDatabaseURLVar, devMigrateDatabaseURL, db.RoleMigrate)
	case Bootstrap:
		// Bootstrap sets each role's password to the one its connection string carries, so
		// the strings the other commands use are the only place a password is written down.
		c.DatabaseURL = url(DatabaseURLVar, devDatabaseURL, db.RoleApp)
		c.MigrateDatabaseURL = url(MigrateDatabaseURLVar, devMigrateDatabaseURL, db.RoleMigrate)
		c.MeterDatabaseURL = url(MeterDatabaseURLVar, devMeterDatabaseURL, db.RoleMeter)
		c.ReplicationDatabaseURL = url(ReplicationDatabaseURLVar, devReplicationDatabaseURL, db.RolePowerSync)
		c.AdminDatabaseURL = url(AdminDatabaseURLVar, devAdminDatabaseURL, "")
		l.sameDatabase(c.DatabaseURL, c.MigrateDatabaseURL, c.MeterDatabaseURL, c.ReplicationDatabaseURL)
		// The bucket storage may be kept on a cluster of its own, which Bootstrap does not prepare:
		// outside development it is prepared here only when it is named.
		if value := l.str(PowerSyncStorageURLVar, ""); value != "" || dev {
			c.PowerSyncStorageURL = url(PowerSyncStorageURLVar, devPowerSyncStorageURL, "")
			l.storage(c, value != "")
		}
		l.localDefaults(defaulted, c.AdminDatabaseURL)
	default:
		l.fail("unknown command %q", command)
	}

	if len(l.errs) > 0 {
		return nil, fmt.Errorf("config: %w", errors.Join(l.errs...))
	}
	return c, nil
}

// serving reads what serving the accounts needs (item 8).
func (l *loader) serving(c *Config, dev bool) {
	required := func(key, devDefault string) string {
		value, ok := l.getenv(key)
		if ok && value != "" {
			return value
		}
		if !dev {
			l.fail("%s is required outside development", key)
			return ""
		}
		return devDefault
	}

	if web := required(WebURLVar, devWebURL); web != "" {
		u, err := url.Parse(web)
		switch {
		case err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil ||
			u.RawQuery != "" || u.Fragment != "":
			l.fail("%s is %q; want the web client's absolute http(s) URL", WebURLVar, web)
		// Over plain HTTP a browser keeps none of the session's Secure cookies, and the emails'
		// links would carry their tokens where anyone on the way reads them.
		case !dev && u.Scheme != "https":
			l.fail("%s is %q; outside development the web client is served over https", WebURLVar, web)
		default:
			c.WebURL = u
			c.AllowedOrigins = append(c.AllowedOrigins, u.Scheme+"://"+u.Host)
		}
	}
	for _, origin := range strings.Split(l.str(AllowedOriginsVar, ""), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, origin)
		}
	}
	if _, err := session.NewOrigins(c.AllowedOrigins...); err != nil {
		l.fail("%s: %v", AllowedOriginsVar, err)
	}

	// Named outside development, or `none` said: behind a load balancer the server was not told
	// of, every client would be the balancer, and share one network's sign-in and registration
	// limits with every other. A list that names nothing, a template's empty variables joined by a
	// comma, says neither.
	if proxies := required(TrustedProxiesVar, NoProxies); proxies != NoProxies && proxies != "" {
		parsed, err := clientip.ParsePrefixes(proxies)
		switch {
		case err != nil:
			l.fail("%s: %v", TrustedProxiesVar, err)
		case len(parsed) == 0:
			l.fail("%s is %q, which names no proxy; want the proxies' addresses or %q", TrustedProxiesVar, proxies, NoProxies)
		}
		c.TrustedProxies = parsed
	}

	// The mail server's URL carries its credentials: it is a secret, and is never named in an
	// error.
	c.SMTPURL = required(SMTPURLVar, devSMTPURL)
	c.MailFrom = required(MailFromVar, devMailFrom)
	if c.SMTPURL != "" && c.MailFrom != "" {
		if _, err := mail.NewSMTP(c.SMTPURL, c.MailFrom); err != nil {
			l.fail("%s or %s: %v", SMTPURLVar, MailFromVar, err)
		}
	}

	c.BreachCorpus = required(BreachCorpusVar, "")

	// Where a client reaches PowerSync, which its sync credentials name: https outside development,
	// since the token the credentials carry would otherwise travel where anyone on the way reads it.
	if ps := required(PowerSyncURLVar, devPowerSyncURL); ps != "" {
		u, err := url.Parse(ps)
		switch {
		case err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil ||
			u.RawQuery != "" || u.Fragment != "":
			l.fail("%s is %q; want PowerSync's absolute http(s) URL", PowerSyncURLVar, ps)
		case !dev && u.Scheme != "https":
			l.fail("%s is %q; outside development PowerSync is reached over https", PowerSyncURLVar, ps)
		default:
			c.PowerSyncURL = strings.TrimRight(ps, "/")
		}
	}

	// The keys are secrets: an error names the variable, never its value, and outside development
	// no published key is taken for one left unset.
	if keys := required(TokenKeysVar, devTokenKeys); keys != "" {
		k, err := token.ParseKeys(keys)
		switch {
		case err != nil:
			l.fail("%s: %v", TokenKeysVar, err)
		case !dev && strings.Contains(keys, strings.TrimRight(devTokenKeys, "=")):
			l.fail("%s holds the published development key, which only development may use", TokenKeysVar)
		}
		c.TokenKeys = k
	}
	if keys := required(MFAKeysVar, devMFAKeys); keys != "" {
		k, err := mfa.ParseKeys(keys)
		switch {
		case err != nil:
			l.fail("%s: %v", MFAKeysVar, err)
		case !dev && strings.Contains(keys, strings.TrimRight(devMFAKeys, "=")):
			l.fail("%s holds the published development key, which only development may use", MFAKeysVar)
		}
		c.MFAKeys = k
	}

	c.MinClients = clientversion.Minimums{}
	for _, m := range []struct{ key, client string }{
		{MinMobileVersionVar, clientversion.Mobile}, {MinWebVersionVar, clientversion.Web},
	} {
		if v := l.str(m.key, ""); v != "" {
			version, ok := clientversion.ParseVersion(v)
			if !ok {
				l.fail("%s is %q; want a version such as 1.4.2", m.key, v)
			}
			c.MinClients[m.client] = version
		}
	}

	l.providers(c)
}

// files reads what the files pipeline needs (item 14): the object store, whose URL carries its
// credentials and is never named in an error, reached over https outside development and never
// with the compose store's published secret; where clients reach it, when that is not where the
// server does; the converter sidecar; and where and for how long an upload's body is read.
func (l *loader) files(c *Config, dev bool) {
	raw, ok := l.getenv(ObjectStoreURLVar)
	switch {
	case (!ok || raw == "") && !dev:
		l.fail("%s is required outside development", ObjectStoreURLVar)
	case !ok || raw == "":
		raw = devObjectStoreURL
	}
	if raw != "" {
		loc, err := objectstore.ParseURL(raw)
		switch {
		case err != nil:
			l.fail("%s: %v", ObjectStoreURLVar, err)
		case !dev && loc.Endpoint.Scheme != "https":
			l.fail("%s: outside development the object store is reached over https", ObjectStoreURLVar)
		case !dev && loc.Secret == devObjectStoreSecret:
			l.fail("%s holds the compose object store's published secret, which only development may use", ObjectStoreURLVar)
		default:
			c.ObjectStore = loc
		}
	}
	if public := l.str(ObjectStorePublicURLVar, ""); public != "" {
		u, err := url.Parse(public)
		switch {
		case err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil ||
			(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "":
			l.fail("%s is %s; want the object store's http(s) scheme and host", ObjectStorePublicURLVar, quotedURL(public))
		case !dev && u.Scheme != "https":
			l.fail("%s is %s; outside development clients reach the object store over https", ObjectStorePublicURLVar, quotedURL(public))
		default:
			c.ObjectStorePublic = &url.URL{Scheme: u.Scheme, Host: u.Host}
		}
	}
	converter, ok := l.getenv(ConverterURLVar)
	switch {
	case (!ok || converter == "") && !dev:
		l.fail("%s is required outside development", ConverterURLVar)
	case !ok || converter == "":
		converter = devConverterURL
	}
	if converter != "" {
		if u, err := url.Parse(converter); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
			l.fail("%s is %s; want the converter's absolute http(s) URL", ConverterURLVar, quotedURL(converter))
		} else {
			c.ConverterURL = strings.TrimRight(converter, "/")
		}
	}
	c.UploadDir = l.str(UploadDirVar, "")
	c.UploadTimeout = l.duration(UploadTimeoutVar, 15*time.Minute)
}

// quotedURL is raw as an error about it quotes it: its password replaced, since a setting that refuses
// a URL carrying credentials may still have been given one, and none of it when it does not parse as
// a URL, since its text may then hold one where no parser finds it.
func quotedURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "a value that does not parse as a URL"
	}
	return strconv.Quote(u.Redacted())
}

// providers reads the identity providers (item 9): each configured whole or not at all, and none
// without a redirect URI to send a person back to.
func (l *loader) providers(c *Config) {
	for _, raw := range strings.Split(l.str(RedirectURIsVar, ""), ",") {
		if raw = strings.TrimSpace(raw); raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Scheme == "" || u.Fragment != "" || u.User != nil || (u.Host == "" && u.Opaque == "" && u.Path == "") {
			l.fail("%s: %q is not an absolute URI without a fragment", RedirectURIsVar, raw)
			continue
		}
		c.RedirectURIs = append(c.RedirectURIs, raw)
	}
	// set reports whether every one of keys is set, and fails when only some are.
	set := func(name string, keys ...string) bool {
		var given []string
		for _, k := range keys {
			if l.str(k, "") != "" {
				given = append(given, k)
			}
		}
		if len(given) > 0 && len(given) < len(keys) {
			l.fail("%s is configured by %s together; only %s is set", name, strings.Join(keys, ", "), strings.Join(given, ", "))
		}
		return len(given) == len(keys)
	}
	if set("Google", GoogleClientIDVar, GoogleClientSecretVar) {
		c.Google = &federation.Config{ClientID: l.str(GoogleClientIDVar, ""), ClientSecret: l.str(GoogleClientSecretVar, "")}
	}
	if set("Apple", AppleClientIDVar, AppleTeamIDVar, AppleKeyIDVar, ApplePrivateKeyVar) {
		key, err := federation.ParseAppleKey(l.str(ApplePrivateKeyVar, ""))
		if err != nil {
			l.fail("%s: %v", ApplePrivateKeyVar, err)
		}
		c.Apple = &federation.Config{ClientID: l.str(AppleClientIDVar, ""),
			Apple: &federation.AppleKey{TeamID: l.str(AppleTeamIDVar, ""), KeyID: l.str(AppleKeyIDVar, ""), Key: key}}
	}
	if (c.Google != nil || c.Apple != nil) && len(c.RedirectURIs) == 0 {
		l.fail("%s names no redirect URI, which a configured provider needs", RedirectURIsVar)
	}
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
		if !loopback(host) && !strings.HasPrefix(host, "/") {
			return false
		}
	}
	return true
}

// storage checks PowerSync's bucket storage is a database of its own, beside the household's, owned
// by a role of its own that logs in with a password: it holds every household's replicated rows
// outside row-level security, so neither the household database nor any role of the server's is
// it. Nor is the administrator's role, which bootstrap would otherwise bring down to the storage
// role's attributes and password. The role and the password are the ones the URL itself writes:
// pgconn fills a role the connection string leaves out from PGUSER or the operating system's user,
// and a password from PGPASSWORD or ~/.pgpass, and bootstrap would then make, or bring down to the
// storage role's attributes and a password nobody chose for it, whichever role the environment
// names, another application's among them. Bootstrap prepares it on the administrator's cluster, so
// a storage named, rather than defaulted, on another cluster is refused: bootstrap would make its
// role and its database where PowerSync never looks, and leave the cluster PowerSync connects to
// unprepared. A storage kept on a cluster of its own is left unnamed, and prepared there.
func (l *loader) storage(c *Config, named bool) {
	if c.PowerSyncStorageURL == "" {
		return
	}
	cfg, err := pgconn.ParseConfig(c.PowerSyncStorageURL)
	if err != nil {
		return // url has reported it.
	}
	household, _ := Database(c.DatabaseURL)
	admin, err := pgconn.ParseConfig(c.AdminDatabaseURL)
	switch {
	case cfg.Database == "" || cfg.Database == household:
		l.fail("%s names the database %q; PowerSync's bucket storage is a database of its own", PowerSyncStorageURLVar, cfg.Database)
	case !written(c.PowerSyncStorageURL, cfg):
		l.fail("%s carries no role or no password of its own; write both in its postgres:// URL, which otherwise logs in as the environment's",
			PowerSyncStorageURLVar)
	case slices.Contains(db.ManagedRoles(), cfg.User):
		l.fail("%s logs in as %s; the bucket storage is owned by a role of its own", PowerSyncStorageURLVar, cfg.User)
	case err == nil && cfg.User == admin.User:
		l.fail("%s logs in as %s, the administrator %s names; the bucket storage is owned by a role of its own",
			PowerSyncStorageURLVar, cfg.User, AdminDatabaseURLVar)
	case named && err == nil && !sameCluster(cfg, admin):
		l.fail("%s names the cluster at %s, and bootstrap prepares the bucket storage on the administrator's, at %s (%s); leave it unset when the storage is kept on a cluster of its own",
			PowerSyncStorageURLVar, net.JoinHostPort(cfg.Host, strconv.Itoa(int(cfg.Port))),
			net.JoinHostPort(admin.Host, strconv.Itoa(int(admin.Port))), AdminDatabaseURLVar)
	}
}

// written reports whether conn, a postgres:// URL, writes the role and the password cfg, what pgconn
// read it as, logs in with: a role and a non-empty password in its user information, which no query
// parameter overrides. A string that leaves either out takes it from the environment.
func written(conn string, cfg *pgconn.Config) bool {
	u, err := url.Parse(conn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil {
		return false
	}
	password, ok := u.User.Password()
	return u.User.Username() != "" && ok && password != "" && cfg.User == u.User.Username() && cfg.Password == password
}

// sameCluster reports whether a and b reach one PostgreSQL: at one port, of one host, or of the
// loopback however each spells it.
func sameCluster(a, b *pgconn.Config) bool {
	return a.Port == b.Port && (a.Host == b.Host || (loopback(a.Host) && loopback(b.Host)))
}

// loopback reports whether host is this machine's, over the network: localhost, or a loopback
// address.
func loopback(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
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
