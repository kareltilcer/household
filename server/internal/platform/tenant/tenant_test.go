package tenant_test

import (
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

func TestTheMiddlewareNeedsAPoolAndALogger(t *testing.T) {
	if _, err := tenant.Middleware(tenant.Config{Logger: slog.New(slog.DiscardHandler)}); err == nil {
		t.Error("no pool")
	}
}
