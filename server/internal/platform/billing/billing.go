// Package billing is a household's subscription at the payment processor (PRD 04 §1, §4, §6; plan
// item 19, ADR 0019): one subscription a household, paid by one of its owners, for a flat fee and
// whole 10 GB blocks of storage above the 5 GB it includes.
//
// The processor is Stripe, behind Processor. A card never reaches this server: the web client
// confirms a payment, or a card for later charges, with Stripe's Payment Element, by the client
// secret a route here hands it (Q17). What is kept is the processor's ids, a payment method's summary,
// and the invoices as it issued them (01022).
//
// The household's own state stays on its row (ADR 0017), and moves as the processor says: a webhook
// names a subscription, an invoice or a setup, the handler reads it from the processor as it stands,
// under the household's lock, records it, and then settles the household's row from what is recorded
// (household.Bill), through the mutation spine: active with every clock cleared, past_due with its
// dunning_ends_at, grace once the processor gives up, canceled with its lapsed_at and retained_until
// once a cancelled subscription's period ends. A webhook delivered twice, or out of order, settles
// the same state, and the hourly job (household.Service.Transition) stays the backstop for one that
// never arrives.
//
// Storage is billed by the calendar month, UTC's, in arrears (D-128): each night BillStorage adds the
// month that ended as one line to the subscription's next invoice, the blocks its daily average
// came to (storage.Allowance.Blocks). The storage screen shows the same arithmetic all month
// (FR-BI4).
//
// Everything here is the payer's and the other owners': a member or a child is answered 404, as for
// a screen that is no part of their app (FR-BI5). Every route under …/billing is exempt from the
// entitlement gate, since it is what fixes the state (FR-BI1).
package billing

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Querier reads across households: the meter role's pool (PRD 01 §2.3).
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Config is what the service needs.
type Config struct {
	// Pool opens the transactions, connected as the request role.
	Pool tenant.Beginner
	// Meter finds the households with a subscription, whose month of storage the nightly job bills,
	// connected as the meter role.
	Meter Querier
	Log   *slog.Logger
	// Processor is the payment processor, nil when none is configured: every route that would ask
	// it something then answers 503, and the rest read what is kept.
	Processor Processor
	// Prices are the plans by currency, DefaultPrices when nil.
	Prices Prices
	// PublishableKey is the processor's key a client confirms with, which a confirmation carries.
	PublishableKey string
	// AutomaticTax has the processor compute the tax on each invoice (PRD 04 §1).
	AutomaticTax bool
	// Allowance is what a household may store, storage.Default when zero.
	Allowance storage.Allowance
	// Notify sends what billing tells the payer and the owners.
	Notify *notify.Service
	// Catalogs render an invoice line's description in the household's language.
	Catalogs *i18n.Catalogs
	// Catalog is the module registry with admin, which the system's mutations are checked against.
	Catalog *module.Registry
	// Now is the clock; time.Now when nil.
	Now func() time.Time
}

// Service serves billing.
type Service struct {
	Config
}

// New returns the service.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Meter == nil || cfg.Log == nil || cfg.Notify == nil || cfg.Catalogs == nil || cfg.Catalog == nil {
		return nil, errors.New("billing: the service is missing a dependency")
	}
	if cfg.Prices == nil {
		cfg.Prices = DefaultPrices()
	}
	if _, ok := cfg.Prices[Fallback]; !ok {
		return nil, errors.New("billing: the prices name no " + Fallback + " plan")
	}
	if cfg.Allowance == (storage.Allowance{}) {
		cfg.Allowance = storage.Default
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{Config: cfg}, nil
}

// PublicRoutes registers the processor's webhook, on the API's router, before any authentication:
// its signature is what proves it.
func (s *Service) PublicRoutes(r chi.Router) {
	r.Post("/webhooks/stripe", s.webhook)
}

// HouseholdRoutes registers the billing routes that keep the member's Idempotency-Key in the
// household, on the API's router, behind the tenant middleware: the reads, and the writes whose
// answer holds no secret.
func (s *Service) HouseholdRoutes(r chi.Router) {
	const b = "/households/{" + tenant.Param + "}/billing"
	r.Get(b+"/subscription", s.getSubscription)
	r.Patch(b+"/subscription", s.changeInterval)
	r.Post(b+"/cancel", s.cancel)
	r.Post(b+"/resume", s.resume)
	r.Post(b+"/transfer", s.offer)
	r.Delete(b+"/transfer", s.withdraw)
	r.Get(b+"/invoices", s.listInvoices)
	r.Get(b+"/invoices/{invoice_id}", s.getInvoice)
	r.Get(b+"/usage", s.getUsage)
}

// SecretRoutes registers the billing routes whose answer carries a client secret, on the API's
// router, behind the tenant middleware but not the member's Idempotency-Key: a secret is never kept
// to be answered with again, as a replica's credentials are not. Each is safe to send twice of
// itself: a subscription still waiting for its payment is answered again, and a setup that is never
// confirmed changes nothing.
func (s *Service) SecretRoutes(r chi.Router) {
	const b = "/households/{" + tenant.Param + "}/billing"
	r.Post(b+"/subscription", s.subscribe)
	r.Post(b+"/payment-method", s.paymentMethod)
	r.Post(b+"/transfer/accept", s.accept)
}

// The problems billing answers with beside the platform's own.
var (
	// errUnavailable answers a request that needs the processor when none is configured, or when it
	// fails on its own side: nothing was changed, and the request may be sent again.
	errUnavailable = problem.New(http.StatusServiceUnavailable, problem.CodeBillingUnavailable)
	// errSubscribed answers a subscribe for a household that has a subscription, and errNotSubscribed
	// a change of one for a household that has none.
	errSubscribed    = problem.New(http.StatusConflict, problem.CodeAlreadySubscribed)
	errNotSubscribed = problem.New(http.StatusConflict, problem.CodeNotSubscribed)
)

// fail answers err's problem: 503 for the processor's own failure, and 500 for an error that is no
// problem, which it logs.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	switch {
	case errors.As(err, &p):
	case errors.Is(err, ErrUnavailable):
		s.Log.LogAttrs(r.Context(), slog.LevelWarn, "billing: the payment processor failed", slog.Any("error", err))
		err = errUnavailable
	default:
		s.Log.LogAttrs(r.Context(), slog.LevelError, "billing request failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}

// forbidden is the 403 for an owner who can see billing and may not do this to it: the payer's alone.
func forbidden() *problem.Problem { return problem.New(http.StatusForbidden, problem.CodeForbidden) }

// owner returns ctx's scope for a caller who is one of the household's owners, and 404 for anyone
// else: billing is no part of a member's or a child's app (FR-BI5), and what a caller may not see is
// not found.
func owner(ctx context.Context) (*tenant.Scope, error) {
	scope := tenant.From(ctx)
	if scope == nil {
		return nil, tenant.ErrNoTenant
	}
	if scope.Role() != access.Owner {
		return nil, problem.NotFound()
	}
	return scope, nil
}

// processor is the payment processor, or the 503 when none is configured.
func (s *Service) processor() (Processor, error) {
	if s.Processor == nil {
		return nil, errUnavailable
	}
	return s.Processor, nil
}

// system is ctx in household's context with no caller, carrying the registry and the via a mutation
// of the system's records: the webhooks' and the nightly job's, which act for no member.
func (s *Service) system(ctx context.Context, household uuid.UUID) context.Context {
	return mutation.WithVia(mutation.WithCatalog(tenant.Assume(ctx, s.Pool, household, uuid.Nil, ""), s.Catalog), audit.ViaSystem)
}

// errGone is lock's answer for a household that is not there: one deleted since the processor was
// told of it, whose events are about nothing.
var errGone = errors.New("billing: no such household")

// lock locks household's row until tx ends, as the household surface's own changes of its members,
// its payer and its settings do: what the processor says of a household is read and recorded under
// it, one event at a time, so that two deliveries cannot record the older reading last. FOR NO KEY
// UPDATE, so that another mutation's audit event, whose foreign key locks the row FOR KEY SHARE, is
// not held up by it.
func lock(ctx context.Context, tx pgx.Tx, household uuid.UUID) error {
	var one int
	err := tx.QueryRow(ctx, "SELECT 1 FROM households WHERE id = $1 FOR NO KEY UPDATE", household).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return errGone
	}
	return err
}
