package cursor_test

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/cursor"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

var byUpdated = cursor.NewKeyset("notes.updated_at", 2)

func TestARoundTripReturnsTheValues(t *testing.T) {
	values := []string{"2026-09-27T08:15:00.123456Z", "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90"}
	got, err := byUpdated.Decode(byUpdated.Encode(values...))
	if err != nil || !slices.Equal(got, values) {
		t.Fatalf("Decode(Encode(%v)) = %v, %v", values, got, err)
	}
}

func TestATokenIsURLSafe(t *testing.T) {
	token := byUpdated.Encode("a?b&c=d/e+f", "ü")
	if url.QueryEscape(token) != token {
		t.Fatalf("%q needs escaping in a query", token)
	}
}

func TestDecodeRefusesWhatItDidNotMint(t *testing.T) {
	byPosition := cursor.NewKeyset("tasks.position", 2)
	for name, token := range map[string]string{
		"not base64":        "%%%",
		"padded base64":     base64.URLEncoding.EncodeToString([]byte("notes.updated_at\x1fa\x1fb")), // 20 bytes: ends in "="
		"another keyset":    byPosition.Encode("a", "b"),
		"too few values":    base64.RawURLEncoding.EncodeToString([]byte("notes.updated_at\x1fa")),
		"too many values":   base64.RawURLEncoding.EncodeToString([]byte("notes.updated_at\x1fa\x1fb\x1fc")),
		"a page number":     "2",
		"the empty string":  "",
		"a plain text pair": base64.RawURLEncoding.EncodeToString([]byte("a,b")),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := byUpdated.Decode(token); !errors.Is(err, cursor.ErrMalformed) {
				t.Fatalf("Decode(%q) error %v, want ErrMalformed", token, err)
			}
		})
	}
}

func request(t *testing.T, query string) *http.Request {
	return httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/households/x/notes?"+query, nil)
}

func TestFromRequestWithoutACursorIsTheFirstPage(t *testing.T) {
	values, err := byUpdated.FromRequest(request(t, "limit=20"))
	if values != nil || err != nil {
		t.Fatalf("got %v, %v; want nil, nil", values, err)
	}
}

// PRD 01 §6: never a silent page one.
func TestFromRequestWithAMalformedCursorIs422(t *testing.T) {
	good := byUpdated.Encode("a", "b")
	for name, query := range map[string]string{
		"malformed": "cursor=garbage",
		"empty":     "cursor=",
		"repeated":  "cursor=" + good + "&cursor=" + good,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := byUpdated.FromRequest(request(t, query))
			var p *problem.Problem
			if !errors.As(err, &p) {
				t.Fatalf("error %v, want a problem", err)
			}
			if p.Status != http.StatusUnprocessableEntity || p.Code != problem.CodeValidationFailed {
				t.Fatalf("problem %d %s, want 422 validation_failed", p.Status, p.Code)
			}
			want := []problem.FieldError{{Field: "query:cursor", Code: "malformed"}}
			if !slices.Equal(p.Errors, want) {
				t.Fatalf("errors %v, want %v", p.Errors, want)
			}
		})
	}

	values, err := byUpdated.FromRequest(request(t, "cursor="+good))
	if err != nil || !slices.Equal(values, []string{"a", "b"}) {
		t.Fatalf("a good cursor: %v, %v", values, err)
	}
}

func TestProgrammingErrorsPanic(t *testing.T) {
	for name, f := range map[string]func(){
		"empty name":      func() { cursor.NewKeyset("", 1) },
		"zero arity":      func() { cursor.NewKeyset("x", 0) },
		"separator":       func() { cursor.NewKeyset("a\x1fb", 1) },
		"wrong arity":     func() { byUpdated.Encode("only one") },
		"separator value": func() { byUpdated.Encode("a\x1f", "b") },
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("did not panic")
				}
			}()
			f()
		})
	}
}
