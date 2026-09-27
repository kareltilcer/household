package grant_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Require and Gate are tested with a resolved tenant, for each level, through the router and a
// test module in internal/app. Outside a household-scoped request there is no level to ask.

func TestRequireOutsideAHouseholdIsAnError(t *testing.T) {
	if err := grant.Require(t.Context(), "garden", access.View); !errors.Is(err, tenant.ErrNoTenant) {
		t.Fatalf("Require outside a household: %v", err)
	}
}

func TestGateOutsideAHouseholdAnswers500(t *testing.T) {
	reached := false
	h := grant.Gate("garden")(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
	if rec.Code != http.StatusInternalServerError || reached {
		t.Fatalf("status %d, reached %v", rec.Code, reached)
	}
}
