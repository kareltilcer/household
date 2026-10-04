package cursor_test

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

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
		// Values PostgreSQL refuses as text, which no row's values are.
		"a NUL":           base64.RawURLEncoding.EncodeToString([]byte("notes.updated_at\x1fa\x00\x1fb")),
		"bytes not UTF-8": base64.RawURLEncoding.EncodeToString([]byte("notes.updated_at\x1fa\xff\x1fb")),
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

// A listing ordered newest first, by an instant and then an id, resumes after the row its cursor
// names: After mints the cursor of a page's last row, Before reads it back, to the microsecond and
// in UTC whatever zone the row's instant came in, and the first page has no instant to resume from.
// A cursor of the keyset whose values are not an instant and an id is the 422.
func TestAnInstantKeysetResumesAfterItsLastRow(t *testing.T) {
	at, id := time.Date(2026, 9, 27, 10, 15, 0, 123456000, time.FixedZone("CEST", 2*60*60)), uuid.MustParse("0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90")
	meta := byUpdated.After(at, id)
	if !meta.HasMore || meta.NextCursor == nil {
		t.Fatalf("a page more rows follow: %+v", meta)
	}
	before, last, err := byUpdated.Before(request(t, "cursor="+*meta.NextCursor))
	if err != nil || before == nil || !before.Equal(at) || before.Location() != time.UTC || last != id {
		t.Fatalf("Before(After(%v, %v)) = %v, %v, %v", at, id, before, last, err)
	}
	if before, last, err := byUpdated.Before(request(t, "limit=20")); before != nil || last != uuid.Nil || err != nil {
		t.Fatalf("the first page resumes from %v, %v, %v", before, last, err)
	}
	if meta := (cursor.PageMeta{}); meta.HasMore || meta.NextCursor != nil {
		t.Fatalf("the last page: %+v", meta)
	}
	for name, token := range map[string]string{
		"no instant": byUpdated.Encode("yesterday", id.String()),
		"no id":      byUpdated.Encode("2026-09-27T08:15:00Z", "the-last-one"),
		"not minted": "nonsense",
	} {
		_, _, err := byUpdated.Before(request(t, "cursor="+token))
		var p *problem.Problem
		if !errors.As(err, &p) || p.Status != http.StatusUnprocessableEntity {
			t.Errorf("%s: %v, want the 422", name, err)
		}
	}
}

// The page size is the request's, the contract's default when it names none, and never more than the
// contract's most, whatever reached the handler.
func TestTheLimitIsTheContracts(t *testing.T) {
	for query, want := range map[string]int{"": 50, "limit=1": 1, "limit=200": 200, "limit=201": 200, "limit=0": 50, "limit=many": 50} {
		if got := cursor.Limit(request(t, query)); got != want {
			t.Errorf("%q: a page of %d, want %d", query, got, want)
		}
	}
}

func TestProgrammingErrorsPanic(t *testing.T) {
	for name, f := range map[string]func(){
		"empty name":        func() { cursor.NewKeyset("", 1) },
		"zero arity":        func() { cursor.NewKeyset("x", 0) },
		"separator":         func() { cursor.NewKeyset("a\x1fb", 1) },
		"wrong arity":       func() { byUpdated.Encode("only one") },
		"separator value":   func() { byUpdated.Encode("a\x1f", "b") },
		"no instant keyset": func() { _, _, _ = cursor.NewKeyset("tasks.position", 1).Before(request(t, "limit=20")) },
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
