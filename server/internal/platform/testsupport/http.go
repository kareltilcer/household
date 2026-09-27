package testsupport

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/contract"
)

// Serve sends req through router, the server's root router, and checks the response
// against the contract (contract.ValidateResponse): a status the matched operation
// declares, a body its schema accepts, and a valid problem document on every error. A
// response that breaks the contract fails the test, whatever the test itself asserts.
func Serve(t testing.TB, router chi.Router, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	c, err := contract.Load()
	if err != nil {
		t.Fatalf("load the contract: %v", err)
	}
	rctx := chi.NewRouteContext()
	pattern := strings.TrimPrefix(router.Find(rctx, req.Method, req.URL.Path), contract.BasePath)
	params := make(map[string]string, len(rctx.URLParams.Keys))
	for i, key := range rctx.URLParams.Keys {
		params[key] = rctx.URLParams.Values[i]
	}
	if err := c.ValidateResponse(req, pattern, params, rec.Code, rec.Header(), rec.Body.Bytes()); err != nil {
		t.Errorf("the response breaks the contract: %v\n%s", err, rec.Body.String())
	}
	return rec
}
