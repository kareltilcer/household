package config_test

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/notify"
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

// The serving process gets the request role's connection and the meter role's, which reads across
// households for the usage sample and the files workers (item 14), and nothing else: never the
// administrator's, which only bootstrap holds.
func TestEachCommandGetsOnlyTheConnectionsItUses(t *testing.T) {
	serve, _ := config.Load(config.Serve, env(nil))
	if serve.DatabaseURL == "" || serve.MigrateDatabaseURL != "" || serve.AdminDatabaseURL != "" || serve.MeterDatabaseURL == "" {
		t.Errorf("serve: %+v", serve)
	}
	migrate, _ := config.Load(config.Migrate, env(nil))
	if migrate.MigrateDatabaseURL == "" || migrate.DatabaseURL != "" || migrate.AdminDatabaseURL != "" {
		t.Errorf("migrate: %+v", migrate)
	}
	bootstrap, _ := config.Load(config.Bootstrap, env(nil))
	if bootstrap.AdminDatabaseURL == "" || bootstrap.DatabaseURL == "" || bootstrap.MigrateDatabaseURL == "" || bootstrap.MeterDatabaseURL == "" ||
		bootstrap.ReplicationDatabaseURL == "" || bootstrap.PowerSyncStorageURL == "" {
		t.Errorf("bootstrap: %+v", bootstrap)
	}
	// PowerSync's credentials are the service's, and bootstrap's to set: never the serving process's.
	if serve.ReplicationDatabaseURL != "" || serve.PowerSyncStorageURL != "" || serve.PowerSyncURL == "" {
		t.Errorf("serve: %+v", serve)
	}
}

func TestOutsideDevelopmentNothingIsDefaulted(t *testing.T) {
	for _, e := range []string{"staging", "production"} {
		_, err := config.Load(config.Bootstrap, env(map[string]string{config.EnvVar: e}))
		if err == nil {
			t.Fatalf("%s: loaded with no connection strings", e)
		}
		for _, key := range []string{config.DatabaseURLVar, config.MigrateDatabaseURLVar, config.MeterDatabaseURLVar, config.AdminDatabaseURLVar,
			config.ReplicationDatabaseURLVar} {
			if !strings.Contains(err.Error(), key) {
				t.Errorf("%s: the error does not name %s: %v", e, key, err)
			}
		}
	}

	_, err := config.Load(config.Serve, env(map[string]string{
		config.EnvVar:         "production",
		config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
	}))
	for _, key := range []string{config.WebURLVar, config.TrustedProxiesVar, config.SMTPURLVar, config.MailFromVar, config.BreachCorpusVar,
		config.TokenKeysVar, config.MFAKeysVar, config.PowerSyncURLVar, config.MeterDatabaseURLVar, config.ObjectStoreURLVar,
		config.ConverterURLVar, config.NotifyKeysVar, config.VAPIDKeyVar} {
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
		config.WebURLVar:           "https://app.household.example",
		config.TrustedProxiesVar:   config.NoProxies,
		config.SMTPURLVar:          "smtps://mailer:" + "pw" + "@smtp.example:465",
		config.MailFromVar:         "Household <no-reply@household.example>",
		config.BreachCorpusVar:     "/var/lib/household/breached.bin",
		config.TokenKeysVar:        base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		config.MFAKeysVar:          base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)),
		config.PowerSyncURLVar:     "https://sync.household.example",
		config.MeterDatabaseURLVar: dsn("household_meter", "m3ter", "db.internal:5432", "household"),
		config.ObjectStoreURLVar:   "https://AKIA:" + "s3cret" + "@objects.household.example/household?region=eu-central-1",
		config.ConverterURLVar:     "http://converter:3100",
		config.NotifyKeysVar:       base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32)),
		config.VAPIDKeyVar:         base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{5}, 32)),
	} {
		if _, ok := vars[key]; !ok {
			vars[key] = value
		}
	}
	return vars
}

// In development the files pipeline defaults to the compose object store, its bucket and its
// published credentials, and to the converter of the compose convert profile; elsewhere each is
// named, the store is reached over https, and the published secret is refused.
func TestTheFilesSettings(t *testing.T) {
	c, err := config.Load(config.Serve, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.ObjectStore.Endpoint.String() != "http://127.0.0.1:9000" || c.ObjectStore.Bucket != "household" ||
		c.ObjectStore.AccessKey != "household" || c.ObjectStorePublic != nil || c.ConverterURL != "http://127.0.0.1:3100" ||
		c.UploadTimeout != 15*time.Minute {
		t.Fatalf("%+v", c)
	}

	c, err = config.Load(config.Serve, env(serving(map[string]string{
		config.EnvVar:                  "production",
		config.DatabaseURLVar:          dsn("household_app", "s3cret", "db.internal:5432", "household"),
		config.ObjectStorePublicURLVar: "https://files.household.example/",
		config.UploadDirVar:            "/var/lib/household/uploads",
		config.UploadTimeoutVar:        "30m",
	})))
	if err != nil {
		t.Fatal(err)
	}
	if c.ObjectStore.Endpoint.String() != "https://objects.household.example" || c.ObjectStore.Region != "eu-central-1" ||
		c.ObjectStorePublic.String() != "https://files.household.example" || c.ConverterURL != "http://converter:3100" ||
		c.UploadDir != "/var/lib/household/uploads" || c.UploadTimeout != 30*time.Minute {
		t.Fatalf("%+v", c)
	}

	for name, vars := range map[string]map[string]string{
		"a store over http":             {config.ObjectStoreURLVar: "http://AKIA:" + "s3cret" + "@objects.internal:9000/household"},
		"the published secret":          {config.ObjectStoreURLVar: "https://household:" + "household-local-only" + "@objects.household.example/household"},
		"a store with no bucket":        {config.ObjectStoreURLVar: "https://AKIA:" + "s3cret" + "@objects.household.example"},
		"a public URL with a path":      {config.ObjectStorePublicURLVar: "https://files.household.example/household"},
		"a public URL over http":        {config.ObjectStorePublicURLVar: "http://files.household.example"},
		"a converter that is not a URL": {config.ConverterURLVar: "converter:3100"},
		// A URL that carries no credentials refuses one it was given, and names it without them.
		"a public URL with credentials":   {config.ObjectStorePublicURLVar: "https://AKIA:" + "s3cret" + "@files.household.example"},
		"a converter with credentials":    {config.ConverterURLVar: "http://svc:" + "s3cret" + "@converter:3100"},
		"a converter that does not parse": {config.ConverterURLVar: "http://svc:" + "s3cret%zz" + "@converter:3100"},
	} {
		vars[config.EnvVar] = "production"
		vars[config.DatabaseURLVar] = dsn("household_app", "s3cret", "db.internal:5432", "household")
		_, err := config.Load(config.Serve, env(serving(vars)))
		if err == nil {
			t.Errorf("%s: loaded", name)
			continue
		}
		if strings.Contains(err.Error(), "s3cret") || strings.Contains(err.Error(), "household-local-only") {
			t.Errorf("%s: the error names the secret: %v", name, err)
		}
	}
}

// In development the account settings default to the web client's dev server and the compose mail
// catcher, and the breached-password screen may be off.
func TestServingInDevelopmentDefaultsTheAccountSettings(t *testing.T) {
	c, err := config.Load(config.Serve, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.WebURL.String() != "http://localhost:5173" || c.SMTPURL != "smtp://127.0.0.1:1025" ||
		c.MailFrom != "Household <no-reply@household.localhost>" || c.BreachCorpus != "" ||
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
	if c.WebURL.String() != "https://app.household.example" || c.BreachCorpus != "/var/lib/household/breached.bin" ||
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

// A list of proxies that names none, empty variables a template joined, is neither the proxies nor
// `none`, and is refused rather than taken for no proxy.
func TestTrustedProxiesNameAProxyOrNone(t *testing.T) {
	for _, proxies := range []string{",", " , ,"} {
		_, err := config.Load(config.Serve, env(serving(map[string]string{
			config.EnvVar:            "production",
			config.DatabaseURLVar:    dsn("household_app", "s3cret", "db.internal:5432", "household"),
			config.TrustedProxiesVar: proxies,
		})))
		if err == nil || !strings.Contains(err.Error(), config.TrustedProxiesVar) {
			t.Errorf("%q: %v", proxies, err)
		}
	}
}

// Outside development the web client is served over https, where its Secure cookies are kept and
// the emails' links travel encrypted; development's dev server is plain http.
func TestOutsideDevelopmentTheWebClientIsServedOverHTTPS(t *testing.T) {
	_, err := config.Load(config.Serve, env(serving(map[string]string{
		config.EnvVar:         "production",
		config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
		config.WebURLVar:      "http://app.household.example",
	})))
	if err == nil || !strings.Contains(err.Error(), config.WebURLVar) {
		t.Fatalf("an http web client in production: %v", err)
	}
	if _, err := config.Load(config.Serve, env(map[string]string{config.WebURLVar: "http://localhost:3000"})); err != nil {
		t.Fatalf("an http web client in development: %v", err)
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
	remote[config.ReplicationDatabaseURLVar] = dsn("household_powersync", "p", "db.internal:5432", "household")
	_, err = config.Load(config.Bootstrap, env(remote))
	if err == nil || !strings.Contains(err.Error(), config.PowerSyncStorageURLVar) {
		t.Fatalf("a remote cluster with the bucket storage's password defaulted: %v", err)
	}
	remote[config.PowerSyncStorageURLVar] = dsn("powersync_storage", "b", "db.internal:5432", "powersync_storage")
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

// PowerSync's bucket storage is a database of its own, owned by a role of its own: it holds every
// household's replicated rows outside row-level security. Bootstrap prepares it on the
// administrator's cluster, so one named on another cluster is refused; outside development it is
// prepared only when named, since it may be kept on a cluster of its own.
func TestPowerSyncsStorageIsADatabaseOfItsOwn(t *testing.T) {
	t.Setenv("PGPASSWORD", "")
	t.Setenv("PGPASSFILE", t.TempDir()+"/none")
	for name, tc := range map[string]struct{ storage, want string }{
		"the household's database": {dsn("powersync_storage", "b", "127.0.0.1", "household"), "a database of its own"},
		"a role of the server's":   {dsn("household_app", "b", "127.0.0.1", "powersync_storage"), "a role of its own"},
		"PowerSync's replication":  {dsn("household_powersync", "b", "127.0.0.1", "powersync_storage"), "a role of its own"},
		"the administrator's role": {dsn("postgres", "b", "127.0.0.1", "powersync_storage"), "the administrator"},
		"no password":              {dsn("powersync_storage", "", "127.0.0.1", "powersync_storage"), "no role or no password"},
		"a role a parameter swaps": {dsn("powersync_storage", "b", "127.0.0.1", "powersync_storage") + "?user=someone_else", "no role or no password"},
		"another cluster":          {dsn("powersync_storage", "b", "buckets.internal:5432", "powersync_storage"), "leave it unset"},
		"another port":             {dsn("powersync_storage", "b", "127.0.0.1:5433", "powersync_storage"), "leave it unset"},
	} {
		_, err := config.Load(config.Bootstrap, env(map[string]string{config.PowerSyncStorageURLVar: tc.storage}))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: error %v, want one containing %q", name, err, tc.want)
		}
	}
	// A string that names no role nor password is not given the environment's: pgconn would log in as
	// PGUSER, or the operating system's user, with PGPASSWORD, and bootstrap would bring that role down
	// to a storage role's attributes and password.
	t.Setenv("PGUSER", "someone_else")
	t.Setenv("PGPASSWORD", "theirs")
	if _, err := config.Load(config.Bootstrap, env(map[string]string{
		config.PowerSyncStorageURLVar: "postgres://127.0.0.1:5432/powersync_storage",
	})); err == nil || !strings.Contains(err.Error(), "no role or no password") {
		t.Errorf("the environment's role and password: %v", err)
	}
	t.Setenv("PGUSER", "")
	t.Setenv("PGPASSWORD", "")
	// The administrator's cluster, at the loopback however it is spelled.
	if _, err := config.Load(config.Bootstrap, env(map[string]string{
		config.PowerSyncStorageURLVar: dsn("powersync_storage", "b", "localhost:5432", "powersync_storage"),
	})); err != nil {
		t.Errorf("the administrator's cluster as localhost: %v", err)
	}
	c, err := config.Load(config.Bootstrap, env(map[string]string{
		config.EnvVar:                    "production",
		config.AdminDatabaseURLVar:       dsn("postgres", "s3cret", "db.internal:5432", "household"),
		config.DatabaseURLVar:            dsn("household_app", "a", "db.internal:5432", "household"),
		config.MigrateDatabaseURLVar:     dsn("household_migrate", "m", "db.internal:5432", "household"),
		config.MeterDatabaseURLVar:       dsn("household_meter", "r", "db.internal:5432", "household"),
		config.ReplicationDatabaseURLVar: dsn("household_powersync", "p", "db.internal:5432", "household"),
	}))
	if err != nil || c.PowerSyncStorageURL != "" {
		t.Fatalf("production, the storage unnamed: %+v %v", c, err)
	}
}

// Outside development PowerSync is reached over https: its URL is where a client sends the token its
// credentials carry.
func TestOutsideDevelopmentPowerSyncIsReachedOverHTTPS(t *testing.T) {
	_, err := config.Load(config.Serve, env(serving(map[string]string{
		config.EnvVar:          "production",
		config.DatabaseURLVar:  dsn("household_app", "s3cret", "db.internal:5432", "household"),
		config.PowerSyncURLVar: "http://sync.household.example",
	})))
	if err == nil || !strings.Contains(err.Error(), config.PowerSyncURLVar) {
		t.Fatalf("PowerSync over http in production: %v", err)
	}
	c, err := config.Load(config.Serve, env(map[string]string{config.PowerSyncURLVar: "http://127.0.0.1:9999/"}))
	if err != nil || c.PowerSyncURL != "http://127.0.0.1:9999" {
		t.Fatalf("PowerSync over http in development: %+v %v", c, err)
	}
	if _, err := config.Load(config.Serve, env(map[string]string{config.PowerSyncURLVar: "sync.household.example"})); err == nil {
		t.Fatal("a PowerSync URL that is not absolute")
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

// Outside development the keys that sign access tokens and seal the second step's secrets must be
// set, and not to the published development ones; no error quotes a key.
func TestTheKeysAreTheDeploymentsOwn(t *testing.T) {
	c, err := config.Load(config.Serve, env(nil))
	if err != nil || c.TokenKeys == nil || c.MFAKeys == nil {
		t.Fatalf("development: %+v %v", c, err)
	}
	devToken := base64.StdEncoding.EncodeToString([]byte("household development access key"))
	_, err = config.Load(config.Serve, env(serving(map[string]string{
		config.EnvVar: "production", config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
		config.TokenKeysVar: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)) + "," + devToken,
		config.MFAKeysVar:   "not base64!",
	})))
	if err == nil || !strings.Contains(err.Error(), config.TokenKeysVar) || !strings.Contains(err.Error(), config.MFAKeysVar) ||
		strings.Contains(err.Error(), devToken) || strings.Contains(err.Error(), "not base64!") {
		t.Fatalf("%v", err)
	}
}

func TestProvidersAreConfiguredWhole(t *testing.T) {
	appleKey := func() string {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		der, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			t.Fatal(err)
		}
		return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	}()
	c, err := config.Load(config.Serve, env(map[string]string{
		config.RedirectURIsVar:       "https://app.household.example/sign-in/callback, household://sign-in",
		config.GoogleClientIDVar:     "id.apps.googleusercontent.com",
		config.GoogleClientSecretVar: "secret",
		config.AppleClientIDVar:      "com.household.web",
		config.AppleTeamIDVar:        "TEAM",
		config.AppleKeyIDVar:         "KEY",
		config.ApplePrivateKeyVar:    appleKey,
		config.MinMobileVersionVar:   "1.6.0",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Google == nil || c.Google.ClientID != "id.apps.googleusercontent.com" || c.Apple == nil || c.Apple.Apple.Key == nil ||
		len(c.RedirectURIs) != 2 || c.MinClients["mobile"].String() != "1.6.0" {
		t.Fatalf("%+v", c)
	}
	if c, err := config.Load(config.Serve, env(nil)); err != nil || c.Google != nil || c.Apple != nil || len(c.MinClients) != 0 {
		t.Fatalf("none configured: %+v %v", c, err)
	}
	for name, vars := range map[string]map[string]string{
		"Google without its secret": {config.GoogleClientIDVar: "id", config.RedirectURIsVar: "https://a.example/cb"},
		"Apple without its key":     {config.AppleClientIDVar: "c", config.AppleTeamIDVar: "t", config.AppleKeyIDVar: "k", config.RedirectURIsVar: "https://a.example/cb"},
		"Apple with a key not PEM":  {config.AppleClientIDVar: "c", config.AppleTeamIDVar: "t", config.AppleKeyIDVar: "k", config.ApplePrivateKeyVar: "nope", config.RedirectURIsVar: "https://a.example/cb"},
		"a provider and no URI":     {config.GoogleClientIDVar: "id", config.GoogleClientSecretVar: "s"},
		"a URI with a fragment":     {config.RedirectURIsVar: "https://a.example/cb#x"},
		"a relative URI":            {config.RedirectURIsVar: "/cb"},
		"a version that is not one": {config.MinWebVersionVar: "1.6"},
	} {
		if _, err := config.Load(config.Serve, env(vars)); err == nil {
			t.Errorf("%s: loaded", name)
		}
	}
}

// In development the notification transport seals and signs with published keys, and reaches Expo's
// own push service; elsewhere each key is named, a published one is refused, a VAPID key that is no
// P-256 private key is refused without being quoted, and Expo is reached over https.
func TestTheNotificationSettings(t *testing.T) {
	c, err := config.Load(config.Serve, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.NotifyKeys == nil || c.VAPIDKey == "" || c.ExpoPushURL != notify.DefaultExpoURL || c.ExpoAccessToken != "" || len(c.PushHosts) != 0 {
		t.Fatalf("development: %+v", c)
	}
	if _, err := notify.VAPIDPublicKey(c.VAPIDKey); err != nil {
		t.Fatalf("the development VAPID key: %v", err)
	}

	dev, err := config.Load(config.Serve, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, key, value, want string
	}{
		{"the published notify key", config.NotifyKeysVar, base64.StdEncoding.EncodeToString([]byte("household development notify key")), "published"},
		{"the published VAPID key", config.VAPIDKeyVar, dev.VAPIDKey, "published"},
		{"a VAPID key of 31 bytes", config.VAPIDKeyVar, base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{5}, 31)), "32 bytes"},
		{"a VAPID key past the curve's order", config.VAPIDKeyVar, base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0xff}, 32)), "P-256"},
		{"Expo over http", config.ExpoPushURLVar, "http://exp.host/--/api/v2/push", "https"},
		{"a push host with a scheme", config.PushHostsVar, "https://push.example", "not a host"},
	} {
		_, err := config.Load(config.Serve, env(serving(map[string]string{
			config.EnvVar:         "production",
			config.DatabaseURLVar: dsn("household_app", "s3cret", "db.internal:5432", "household"),
			tc.key:                tc.value,
		})))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v; want an error saying %q", tc.name, err, tc.want)
			continue
		}
		if tc.key == config.VAPIDKeyVar && strings.Contains(err.Error(), tc.value) {
			t.Errorf("%s: the error quotes the key: %v", tc.name, err)
		}
	}

	c, err = config.Load(config.Serve, env(serving(map[string]string{
		config.EnvVar:             "production",
		config.DatabaseURLVar:     dsn("household_app", "s3cret", "db.internal:5432", "household"),
		config.PushHostsVar:       " Push.Example , ,other.example",
		config.ExpoAccessTokenVar: "expo-token",
	})))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.PushHosts, []string{"push.example", "other.example"}) || c.ExpoAccessToken != "expo-token" {
		t.Errorf("production: hosts %v, token %q", c.PushHosts, c.ExpoAccessToken)
	}
}
