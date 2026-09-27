package testsupport

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
)

// Serve sends req through router, the server's root router, and checks the response
// against the contract (contract.ValidateResponse): a status the matched operation
// declares, a body its schema accepts, and a valid problem document on every error. A
// response that breaks the contract fails the test, whatever the test itself asserts.
func Serve(t testing.TB, router chi.Router, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatalf("load the contract: %v", err)
	}
	return ServeContract(t, c, router, req)
}

// ServeContract is Serve against c: for a router built with a contract other than the
// committed one, a test module's.
func ServeContract(t testing.TB, c *contract.Contract, router chi.Router, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// The route the edge validated the request against, found the way the edge finds it.
	m, _ := contract.Find(router, req.Method, httpx.RoutePath(req))
	if err := c.ValidateResponse(req, m.Path, m.Params, rec.Code, rec.Header(), rec.Body.Bytes()); err != nil {
		t.Errorf("the response breaks the contract: %v\n%s", err, rec.Body.String())
	}
	return rec
}
