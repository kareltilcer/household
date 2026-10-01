package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/avatar"
	"github.com/kareltilcer/household/server/internal/platform/breach"
	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/convert"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/storage"
)

// Served is what the API Run serves is built from, for an Around to reach.
type Served struct {
	// Pool is the database, connected as the request role.
	Pool *pgxpool.Pool
	// Devices are the devices' sign-ins, whose access tokens the API authenticates.
	Devices *device.Store
}

// Around is what a command adds around the API it serves: the conformance suite's own sign-in, for
// one (cmd/conformance-api). It returns the handler to serve in place of router.
type Around func(router http.Handler, s Served) (http.Handler, error)

// Run serves the API for cfg, with the modules registry holds, until ctx ends: the platform, the
// accounts, the households, sync, and each module's routes, as NewRouter assembles them, with around,
// when not nil, around it. name names the process to the database. listening, when not nil, receives
// the address once the server listens.
func Run(ctx context.Context, cfg *config.Config, log *slog.Logger, registry *module.Registry, name string, around Around,
	listening chan<- net.Addr,
) error {
	pool, err := db.Open(ctx, cfg.DatabaseURL, name)
	if err != nil {
		return err
	}
	defer pool.Close()
	meter, err := db.Open(ctx, cfg.MeterDatabaseURL, name+"-meter")
	if err != nil {
		return err
	}
	defer meter.Close()
	c, err := contract.Load()
	if err != nil {
		return err
	}
	pipeline, err := newFiles(ctx, cfg, log, pool, meter)
	if err != nil {
		return err
	}
	avatars, err := avatar.New(pipeline, log, nil)
	if err != nil {
		return err
	}
	background := identity.NewBackground(log, 4, 1024, time.Minute)
	accounts, households, closeAccounts, err := newAccounts(ctx, cfg, log, pool, background, avatars)
	if err != nil {
		return err
	}
	defer closeAccounts()
	replicas, err := replica.New(replica.Config{URL: cfg.PowerSyncURL, Keys: cfg.TokenKeys, Logger: log})
	if err != nil {
		return err
	}
	router, err := NewRouter(Deps{
		Logger:       log,
		Contract:     c,
		Health:       health.New(log, 2*time.Second, health.Database(pool), health.ObjectStore(pipeline.Store())),
		Pool:         pool,
		Modules:      registry,
		MaxBodyBytes: cfg.MaxBodyBytes,
		BodyTimeout:  cfg.BodyTimeout,
		Accounts:     accounts,
		Households:   households,
		Sync:         Sync{Replica: replicas, PushLimit: ratelimit.NewBuckets(ratelimit.PushPerDevice, nil)},
		Storage:      &storage.Picture{Log: log},
	})
	if err != nil {
		return err
	}
	var handler http.Handler = router
	if around != nil {
		if handler, err = around(router, Served{Pool: pool, Devices: accounts.Devices}); err != nil {
			return err
		}
	}
	// The files workers run for as long as the API serves, and release the jobs they hold before
	// the process ends.
	working, stopWorking := context.WithCancel(ctx)
	defer stopWorking()
	workers := make(chan struct{})
	go func() {
		defer close(workers)
		pipeline.Run(working)
	}()
	defer func() {
		stopWorking()
		<-workers
	}()

	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.HTTPAddr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.HTTPAddr, err)
	}
	log.LogAttrs(ctx, slog.LevelInfo, "serving",
		slog.String("env", string(cfg.Env)), slog.String("addr", ln.Addr().String()))
	if listening != nil {
		listening <- ln.Addr()
	}
	// The grace starts when the shutdown does: the requests in flight finish, then the emails the
	// last of them queued go out, and the process ends within one ShutdownTimeout, not two.
	began := make(chan time.Time, 1)
	stop := context.AfterFunc(ctx, func() { began <- time.Now() })
	defer stop()
	served := Serve(ctx, log, NewServer(handler, log), ln, cfg.ShutdownTimeout)
	// Serving that failed before any shutdown began gives the emails a grace of their own.
	deadline := time.Now().Add(cfg.ShutdownTimeout)
	if ctx.Err() != nil {
		deadline = (<-began).Add(cfg.ShutdownTimeout)
	}
	closeCtx, cancel := context.WithDeadline(context.WithoutCancel(ctx), deadline)
	defer cancel()
	return errors.Join(served, background.Close(closeCtx))
}

// newFiles builds the files pipeline (item 14) from cfg: the object store, whose bucket development
// makes for itself, and the converter sidecar. The store is not asked for anything else at start: one
// that cannot be reached fails uploads 502, and nothing else (FR-NF3), and readiness answers degraded
// while it cannot (health.ObjectStore).
func newFiles(ctx context.Context, cfg *config.Config, log *slog.Logger, pool, meter *pgxpool.Pool) (*files.Service, error) {
	store, err := objectstore.New(objectstore.Config{Location: cfg.ObjectStore, Public: cfg.ObjectStorePublic})
	if err != nil {
		return nil, err
	}
	if cfg.Env == config.Development {
		if err := store.CreateBucket(ctx); err != nil {
			log.LogAttrs(ctx, slog.LevelWarn, "the object store's bucket is not there; uploads fail until it is", slog.Any("error", err))
		}
	}
	// The sidecar waits up to two minutes for a slot and gives a document two more once it has one:
	// the client waits longer than both, so that the sidecar's answer, a 503 or a 504, arrives first,
	// and well within a job's ten-minute lease, which a document's PDF and its page share.
	converter, err := convert.New(cfg.ConverterURL, 5*time.Minute)
	if err != nil {
		return nil, err
	}
	return files.New(files.Config{
		Pool: pool, Meter: meter, Store: store, Convert: converter, Log: log, Dir: cfg.UploadDir, Timeout: cfg.UploadTimeout,
	})
}

// newAccounts builds the account surfaces (items 8 and 9) from cfg, and the household surface (item
// 10), which sends its email as they do, and returns what closes them.
func newAccounts(ctx context.Context, cfg *config.Config, log *slog.Logger, pool *pgxpool.Pool,
	background *identity.Background, avatars *avatar.Service,
) (Accounts, *household.Service, func(), error) {
	closeAll := func() {}
	catalogs, err := i18n.Default()
	if err != nil {
		return Accounts{}, nil, closeAll, err
	}
	// One hash at once per CPU the process may use: GOMAXPROCS follows a container's CPU limit,
	// where NumCPU counts the host's, each hash holding 64 MiB.
	hasher, err := password.New(password.Default, runtime.GOMAXPROCS(0))
	if err != nil {
		return Accounts{}, nil, closeAll, err
	}
	var breached func(string) (bool, error)
	if cfg.BreachCorpus != "" {
		corpus, err := breach.Open(cfg.BreachCorpus)
		if err != nil {
			return Accounts{}, nil, closeAll, err
		}
		closeAll = func() { _ = corpus.Close() }
		breached = corpus.Contains
	} else {
		// Only development gets this far without a corpus (config).
		log.LogAttrs(ctx, slog.LevelWarn, "breached-password screening is off: no corpus configured")
	}
	sender, err := mail.NewSMTP(cfg.SMTPURL, cfg.MailFrom)
	if err != nil {
		return Accounts{}, nil, closeAll, err
	}
	origins, err := session.NewOrigins(cfg.AllowedOrigins...)
	if err != nil {
		return Accounts{}, nil, closeAll, err
	}
	sessions := session.NewStore(pool, origins, log, nil)
	devices := device.NewStore(pool, cfg.TokenKeys, log, nil)
	providers := map[string]*federation.Provider{}
	for name, p := range map[string]*federation.Config{federation.Google: cfg.Google, federation.Apple: cfg.Apple} {
		if p == nil {
			continue
		}
		if providers[name], err = federation.New(name, *p); err != nil {
			return Accounts{}, nil, closeAll, err
		}
	}
	throttles := ratelimit.NewThrottles(pool, nil)
	id, err := identity.New(identity.Config{
		Pool: pool, Log: log, Hasher: hasher, Breached: breached,
		Throttles: throttles, Sessions: sessions, Mail: sender, Catalogs: catalogs,
		WebURL: cfg.WebURL, ClientIP: clientip.New(cfg.TrustedProxies), Later: background.Run,
		Devices: devices, MFA: cfg.MFAKeys, Providers: providers, RedirectURIs: cfg.RedirectURIs, Avatars: avatars,
	})
	if err != nil {
		return Accounts{}, nil, closeAll, err
	}
	households, err := household.New(household.Config{
		Pool: pool, Log: log, Throttles: throttles, Mail: sender, Catalogs: catalogs, WebURL: cfg.WebURL,
		Later: background.Run, Accounts: id,
	})
	if err != nil {
		return Accounts{}, nil, closeAll, err
	}
	return Accounts{
		Identity: id, Sessions: sessions, Devices: devices, Origins: origins, MinClients: cfg.MinClients,
		UserLimit:      ratelimit.NewBuckets(ratelimit.PerUser, nil),
		HouseholdLimit: ratelimit.NewBuckets(ratelimit.PerHousehold, nil),
	}, households, closeAll, nil
}
