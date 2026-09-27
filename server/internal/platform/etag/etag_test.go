package etag_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/etag"
)

func TestFormatQuotesTheVersion(t *testing.T) {
	if got := etag.Format(42); got != `"42"` {
		t.Fatalf("Format(42) = %s", got)
	}
	rec := httptest.NewRecorder()
	etag.Set(rec, 7)
	if got := rec.Header().Get("ETag"); got != `"7"` {
		t.Fatalf("Set(7) set %s", got)
	}
}

// If-Match asks for the version its tag spells, compared strongly: a weak tag, a tag this
// server could not have issued, and more than one header match no version, so the write is a
// conflict rather than applied; `*` matches any version, and expects none; no header asks
// nothing.
func TestIfMatch(t *testing.T) {
	for _, tc := range []struct {
		name     string
		values   []string
		present  bool
		allows42 bool
		expected int64
	}{
		{"absent", nil, false, true, -1},
		{"the version", []string{`"42"`}, true, true, 42},
		{"another version", []string{`"41"`}, true, false, 41},
		{"weak", []string{`W/"42"`}, true, false, 0},
		{"leading zero", []string{`"042"`}, true, false, 0},
		{"not a number", []string{`"x"`}, true, false, 0},
		{"zero", []string{`"0"`}, true, false, 0},
		{"negative", []string{`"-42"`}, true, false, 0},
		{"unquoted", []string{`42`}, true, false, 0},
		{"any", []string{`*`}, true, true, -1},
		{"any, spaced", []string{` * `}, true, true, -1},
		{"any in a list", []string{`*, "42"`}, true, false, 0},
		{"a list", []string{`"42", "43"`}, true, false, 0},
		{"two headers", []string{`"42"`, `"42"`}, true, false, 0},
		{"too large", []string{`"9223372036854775808"`}, true, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/", nil)
			for _, v := range tc.values {
				r.Header.Add("If-Match", v)
			}
			p := etag.IfMatch(r)
			if p.Present() != tc.present || p.Allows(42) != tc.allows42 {
				t.Fatalf("present %v, allows 42 %v", p.Present(), p.Allows(42))
			}
			switch e := p.Expected(); {
			case tc.expected < 0 && e != nil:
				t.Fatalf("expects %d with no header", *e)
			case tc.expected >= 0 && (e == nil || *e != tc.expected):
				t.Fatalf("expects %v, want %d", e, tc.expected)
			}
		})
	}
}
