package tenant_test

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The middleware and InTx are tested end to end, through the router and a test module, in
// internal/app.

func TestInTxOutsideAHouseholdRunsNothing(t *testing.T) {
	ran := false
	err := tenant.InTx(t.Context(), func(pgx.Tx) error {
		ran = true
		return nil
	})
	if !errors.Is(err, tenant.ErrNoTenant) || ran {
		t.Fatalf("InTx outside a household: %v, ran %v", err, ran)
	}
	if tenant.From(t.Context()) != nil {
		t.Fatal("a context outside a request carries a tenant")
	}
}

// beginner is a pool that is never asked for a transaction.
type beginner struct{}

func (beginner) Begin(context.Context) (pgx.Tx, error) { return nil, errors.New("not a pool") }

func TestTheMiddlewareNeedsAPoolAndALogger(t *testing.T) {
	logger := slog.New(slog.DiscardHandler)
	if _, err := tenant.Middleware(tenant.Config{Logger: logger}); err == nil {
		t.Error("no pool")
	}
	if _, err := tenant.Middleware(tenant.Config{Pool: beginner{}}); err == nil {
		t.Error("no logger")
	}
	if _, err := tenant.Middleware(tenant.Config{Pool: beginner{}, Logger: logger}); err != nil {
		t.Errorf("a pool and a logger: %v", err)
	}
}
