package session_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/session"
)

func TestAnOriginIsSchemeHostAndPort(t *testing.T) {
	for _, bad := range []string{"app.household.example", "ftp://app.household.example", "https://", "https://app.household.example/app",
		"https://user@app.household.example", "https://app.household.example?x=1", "null", "https://:443"} {
		if _, err := session.NewOrigins(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if _, err := session.NewOrigins("https://App.Household.example/", "http://localhost:5173"); err != nil {
		t.Fatal(err)
	}
}

// An unsafe request that names an origin not on the list is refused, whatever else it carries; a
// safe one, and one that names no origin, pass.
func TestTheOriginMiddleware(t *testing.T) {
	origins, err := session.NewOrigins("https://app.household.example", "http://localhost:5173", "https://shop.household.example:443")
	if err != nil {
		t.Fatal(err)
	}
	h := origins.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for name, tc := range map[string]struct {
		method string
		header map[string]string
		want   int
	}{
		"allowed":                 {http.MethodPost, map[string]string{"Origin": "https://app.household.example"}, http.StatusNoContent},
		"allowed, cased":          {http.MethodPost, map[string]string{"Origin": "HTTPS://APP.household.example"}, http.StatusNoContent},
		"another port":            {http.MethodPost, map[string]string{"Origin": "http://localhost:5174"}, http.StatusForbidden},
		"another site":            {http.MethodDelete, map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		"a sandboxed page":        {http.MethodPost, map[string]string{"Origin": "null"}, http.StatusForbidden},
		"another site's referrer": {http.MethodPatch, map[string]string{"Referer": "https://evil.example/page"}, http.StatusForbidden},
		"an allowed referrer":     {http.MethodPatch, map[string]string{"Referer": "https://app.household.example/account"}, http.StatusNoContent},
		"a native client":         {http.MethodPost, nil, http.StatusNoContent},
		"a safe request":          {http.MethodGet, map[string]string{"Origin": "https://evil.example"}, http.StatusNoContent},
		// A browser leaves a scheme's default port out of Origin; a list may name it.
		"a listed default port":      {http.MethodPost, map[string]string{"Origin": "https://shop.household.example"}, http.StatusNoContent},
		"a default port named":       {http.MethodPost, map[string]string{"Origin": "https://app.household.example:443"}, http.StatusNoContent},
		"the other scheme's default": {http.MethodPost, map[string]string{"Origin": "http://app.household.example:443"}, http.StatusForbidden},
	} {
		req := httptest.NewRequestWithContext(t.Context(), tc.method, "/", nil)
		for k, v := range tc.header {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s: %d, want %d", name, rec.Code, tc.want)
		}
	}
}
