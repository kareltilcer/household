package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	netmail "net/mail"
	"runtime"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/avatar"
	"github.com/kareltilcer/household/server/internal/platform/billing"
	"github.com/kareltilcer/household/server/internal/platform/breach"
	"github.com/kareltilcer/household/server/internal/platform/clientip"
	"github.com/kareltilcer/household/server/internal/platform/config"
	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/convert"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/expiry"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/identity"
	"github.com/kareltilcer/household/server/internal/platform/localtime"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/password"
	"github.com/kareltilcer/household/server/internal/platform/privacy"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/scheduler"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	syncs "github.com/kareltilcer/household/server/internal/platform/sync"
)

// Served is what the API Run serves is built from, for an Around to reach.
type Served struct {
	// Pool is the database, connected as the request role.
	Pool *pgxpool.Pool
	// Devices are the devices' sign-ins, whose access tokens the API authenticates.
	Devices *device.Store
	// Files is the files pipeline, which every upload goes through.
	Files *files.Service
	// Catalog is the module registry with the platform's own, which every mutation is checked against.
	Catalog *module.Registry
	// Log is the API's logger.
	Log *slog.Logger
}

// Around is what a command adds around the API it serves: the conformance suite's own sign-in and its
// attachments' uploads, for one (cmd/conformance-api). It returns the handler to serve in place of
// router.
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
	catalog, err := registry.WithPlatform(household.Admin())
	if err != nil {
		return err
	}
	background := identity.NewBackground(log, 4, 1024, time.Minute)
	accounts, households, notifier, closeAccounts, err := newAccounts(ctx, cfg, log, pool, meter, background, avatars,
		household.Hooks{Lost: Lost(catalog, nil), Named: privacy.Named(nil)})
	if err != nil {
		return err
	}
	defer closeAccounts()
	bills, err := newBilling(cfg, log, pool, meter, catalog, notifier)
	if err != nil {
		return err
	}
	catalogs, err := i18n.Default()
	if err != nil {
		return err
	}
	eraser, err := privacy.New(privacy.Config{
		Pool: pool, Meter: meter, Log: log, Registry: catalog, Accounts: accounts.Identity, Households: households,
		Files: pipeline, Catalogs: catalogs, APIVersion: c.Version(),
	})
	if err != nil {
		return err
	}
	jobs, err := newScheduler(log, pool, meter, registry, catalog, pipeline, avatars, households, notifier, bills, eraser)
	if err != nil {
		return err
	}
	replicas, err := replica.New(replica.Config{URL: cfg.PowerSyncURL, Keys: cfg.TokenKeys, Logger: log})
	if err != nil {
		return err
	}
	router, err := NewRouter(Deps{
		Logger:       log,
		Contract:     c,
		Health:       health.New(log, 2*time.Second, health.Database(pool), health.ObjectStore(pipeline.Store())),
		Pool:         pool,
		Meter:        meter,
		Modules:      registry,
		MaxBodyBytes: cfg.MaxBodyBytes,
		BodyTimeout:  cfg.BodyTimeout,
		Accounts:     accounts,
		Households:   households,
		Sync:         Sync{Replica: replicas, PushLimit: ratelimit.NewBuckets(ratelimit.PushPerDevice, nil)},
		Storage:      &storage.Picture{Log: log},
		Notify:       notifier,
		Billing:      bills,
		Privacy:      eraser,
	})
	if err != nil {
		return err
	}
	var handler http.Handler = router
	if around != nil {
		if handler, err = around(router, Served{Pool: pool, Devices: accounts.Devices, Files: pipeline, Catalog: catalog, Log: log}); err != nil {
			return err
		}
	}
	// The files workers, the notification workers, the export worker and the scheduler run for as
	// long as the API serves, and release what they hold before the process ends: the jobs and the
	// notifications claimed, the export being built, which goes back to the queue unbuilt, and the
	// scheduler's lead.
	working, stopWorking := context.WithCancel(ctx)
	defer stopWorking()
	var workers sync.WaitGroup
	workers.Go(func() { pipeline.Run(working) })
	workers.Go(func() { notifier.Run(working) })
	workers.Go(func() { eraser.Run(working) })
	workers.Go(func() { jobs.Run(working) })
	defer func() {
		stopWorking()
		workers.Wait()
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

// newAccounts builds the account surfaces (items 8 and 9) from cfg, the notification transport (item
// 15), and the household surface (item 10) with hooks, which sends what it tells people through it,
// and returns what closes them.
func newAccounts(ctx context.Context, cfg *config.Config, log *slog.Logger, pool, meter *pgxpool.Pool,
	background *identity.Background, avatars *avatar.Service, hooks household.Hooks,
) (Accounts, *household.Service, *notify.Service, func(), error) {
	closeAll := func() {}
	catalogs, err := i18n.Default()
	if err != nil {
		return Accounts{}, nil, nil, closeAll, err
	}
	// One hash at once per CPU the process may use: GOMAXPROCS follows a container's CPU limit,
	// where NumCPU counts the host's, each hash holding 64 MiB.
	hasher, err := password.New(password.Default, runtime.GOMAXPROCS(0))
	if err != nil {
		return Accounts{}, nil, nil, closeAll, err
	}
	var breached func(string) (bool, error)
	if cfg.BreachCorpus != "" {
		corpus, err := breach.Open(cfg.BreachCorpus)
		if err != nil {
			return Accounts{}, nil, nil, closeAll, err
		}
		closeAll = func() { _ = corpus.Close() }
		breached = corpus.Contains
	} else {
		// Only development gets this far without a corpus (config).
		log.LogAttrs(ctx, slog.LevelWarn, "breached-password screening is off: no corpus configured")
	}
	sender, err := mail.NewSMTP(cfg.SMTPURL, cfg.MailFrom)
	if err != nil {
		return Accounts{}, nil, nil, closeAll, err
	}
	notifier, err := newNotify(cfg, log, pool, meter, catalogs, sender)
	if err != nil {
		return Accounts{}, nil, nil, closeAll, err
	}
	origins, err := session.NewOrigins(cfg.AllowedOrigins...)
	if err != nil {
		return Accounts{}, nil, nil, closeAll, err
	}
	sessions := session.NewStore(pool, origins, log, nil)
	devices := device.NewStore(pool, cfg.TokenKeys, log, nil)
	providers := map[string]*federation.Provider{}
	for name, p := range map[string]*federation.Config{federation.Google: cfg.Google, federation.Apple: cfg.Apple} {
		if p == nil {
			continue
		}
		if providers[name], err = federation.New(name, *p); err != nil {
			return Accounts{}, nil, nil, closeAll, err
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
		return Accounts{}, nil, nil, closeAll, err
	}
	households, err := household.New(household.Config{
		Pool: pool, Log: log, Throttles: throttles, Notify: notifier, WebURL: cfg.WebURL, Accounts: id, Hooks: hooks,
	})
	if err != nil {
		return Accounts{}, nil, nil, closeAll, err
	}
	return Accounts{
		Identity: id, Sessions: sessions, Devices: devices, Origins: origins, MinClients: cfg.MinClients,
		UserLimit:      ratelimit.NewBuckets(ratelimit.PerUser, nil),
		HouseholdLimit: ratelimit.NewBuckets(ratelimit.PerHousehold, nil),
	}, households, notifier, closeAll, nil
}

// newNotify builds the notification transport (item 15) from cfg: Web Push signed with the VAPID key,
// as the server's sender address, Expo's push service, and email through sender.
func newNotify(cfg *config.Config, log *slog.Logger, pool, meter *pgxpool.Pool, catalogs *i18n.Catalogs, sender mail.Sender,
) (*notify.Service, error) {
	from, err := netmail.ParseAddress(cfg.MailFrom)
	if err != nil {
		return nil, err
	}
	webPush, err := notify.NewWebPush(cfg.VAPIDKey, from.Address, nil)
	if err != nil {
		return nil, err
	}
	expo, err := notify.NewExpo(cfg.ExpoPushURL, cfg.ExpoAccessToken, nil)
	if err != nil {
		return nil, err
	}
	return notify.New(notify.Config{
		Pool: pool, Meter: meter, Log: log, Catalogs: catalogs, WebURL: cfg.WebURL, Keys: cfg.NotifyKeys,
		WebPush: webPush, Expo: expo, Receipts: expo, Mail: sender, VAPIDKey: webPush.PublicKey(),
		PushHosts: slices.Concat(notify.DefaultPushHosts, cfg.PushHosts),
	})
}

// newBilling builds billing (item 19) from cfg: Stripe when its keys are configured, and no processor
// when they are not, as development may leave them, when every route that would ask it answers 503.
func newBilling(cfg *config.Config, log *slog.Logger, pool, meter *pgxpool.Pool, catalog *module.Registry, notifier *notify.Service,
) (*billing.Service, error) {
	catalogs, err := i18n.Default()
	if err != nil {
		return nil, err
	}
	var processor billing.Processor
	if cfg.StripeSecretKey != "" {
		if processor, err = billing.NewStripe(billing.StripeConfig{SecretKey: cfg.StripeSecretKey, WebhookSecret: cfg.StripeWebhookSecret}); err != nil {
			return nil, err
		}
	} else {
		// Only development gets this far without one (config).
		log.LogAttrs(context.Background(), slog.LevelWarn, "billing takes no payments: no payment processor configured")
	}
	return billing.New(billing.Config{
		Pool: pool, Meter: meter, Log: log, Processor: processor, Prices: cfg.BillingPrices,
		PublishableKey: cfg.StripePublishableKey, AutomaticTax: cfg.StripeAutomaticTax,
		Notify: notifier, Catalogs: catalogs, Catalog: catalog,
	})
}

// The scheduler's jobs' times (PRD 03 §5): the usage sample at 01:00 UTC, the day the sample is the
// day of (D-109), the month's storage lines half an hour after it, which bill a month that ended from
// samples all taken before it did (D-130), the sweeps of the objects no row records at 02:00, the
// erasure at 02:30 UTC and the expiry sweep at 03:00 UTC, once they are done. PowerSync's compaction
// runs at 04:00 UTC, after them all (deploy/powersync/compact.sh): a job that fails is tried again
// fifteen minutes after it failed, four times a night at most, so the erasure's last try starts at
// 03:15 at the earliest, and later by as long as the tries before it ran. The rows it deleted by 04:00
// leave bucket storage the same night, and those of a try still running then the night after (D-93,
// runbooks/compaction.md).
const (
	nightlySample  = localtime.Clock(1 * 60)
	nightlyStorage = localtime.Clock(1*60 + 30)
	nightlySweeps  = localtime.Clock(2 * 60)
	nightlyErasure = localtime.Clock(2*60 + 30)
	nightlyExpiry  = localtime.Clock(3 * 60)
)

// newScheduler builds the scheduler of the platform's jobs (PRD 03 §5): nightly, the usage sample
// (FR-ST2), which warns the owners of a household nearing a fair-use ceiling (PRD 04 §5) or its storage
// allowance (FR-BI3), the storage lines of the month that ended (item 19), and then the
// sweeps of the objects no row records, a household's and the accounts' pictures (item 14), the
// erasure of what was scheduled for deletion and has come due (item 20), and the expiry sweep, the
// exports' archives among what it removes; hourly, the expiry of single-use tokens and of the invitations that stopped working a
// month ago (D-110), and the households' trial, dunning and grace transitions with the warnings before
// a lapsed household's data is deleted (item 16); every fifteen minutes, Expo's receipts; and every
// minute, PowerSync's replication lag (item 17). Each is a job of its own, so that one that fails is
// tried again alone, not with the others that ran.
// catalog is the module registry with admin, which the invitations' deletions and the transitions are
// checked against.
func newScheduler(log *slog.Logger, pool, meter *pgxpool.Pool, registry, catalog *module.Registry, pipeline *files.Service,
	avatars *avatar.Service, households *household.Service, notifier *notify.Service, bills *billing.Service,
	eraser *privacy.Service,
) (*scheduler.Scheduler, error) {
	sampler := &storage.Sampler{Meter: meter, Pool: pool, Modules: registry, Log: log, Notify: notifier}
	sweeper, err := expiry.New(expiry.Config{Pool: pool, Meter: meter, Log: log, Exports: eraser.Expire,
		Invitations: func(ctx context.Context) (int, error) {
			return households.PurgeInvitations(ctx, meter, catalog)
		}})
	if err != nil {
		return nil, err
	}
	return scheduler.New(scheduler.Config{Pool: pool, Log: log},
		scheduler.Job{Name: "storage.sample", Cadence: scheduler.Daily(nightlySample), Run: func(ctx context.Context) error {
			_, err := sampler.Sample(ctx)
			return err
		}},
		scheduler.Job{Name: "billing.storage", Cadence: scheduler.Daily(nightlyStorage), Run: func(ctx context.Context) error {
			_, err := bills.BillStorage(ctx)
			return err
		}},
		scheduler.Job{Name: "files.sweep", Cadence: scheduler.Daily(nightlySweeps), Run: pipeline.SweepAll},
		scheduler.Job{Name: "avatars.sweep", Cadence: scheduler.Daily(nightlySweeps), Run: func(ctx context.Context) error {
			_, err := avatars.Sweep(ctx, pool)
			return err
		}},
		scheduler.Job{Name: "privacy.erase", Cadence: scheduler.Daily(nightlyErasure), Run: func(ctx context.Context) error {
			_, err := eraser.Erase(ctx)
			return err
		}},
		scheduler.Job{Name: "expiry.sweep", Cadence: scheduler.Daily(nightlyExpiry), Run: sweeper.Sweep},
		scheduler.Job{Name: "expiry.tokens", Cadence: scheduler.Every(time.Hour), Run: sweeper.Tokens},
		scheduler.Job{Name: "entitlement.transitions", Cadence: scheduler.Every(time.Hour), Run: func(ctx context.Context) error {
			_, err := households.Transition(ctx, meter, catalog)
			return err
		}},
		scheduler.Job{Name: "notify.receipts", Cadence: scheduler.Every(15 * time.Minute), Run: notifier.CheckReceipts},
		scheduler.Job{Name: "sync.replication_lag", Cadence: scheduler.Every(time.Minute), Run: func(ctx context.Context) error {
			return syncs.SampleLag(ctx, meter, syncs.LogMetrics{Log: log})
		}},
	)
}
