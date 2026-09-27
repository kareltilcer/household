package app_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file prove the Idempotency-Key through the probe's routes: what a repeat
// is answered with, and that its effect is not repeated.

func withKey(key string) http.Header { return http.Header{"Idempotency-Key": {key}} }

// events counts the audit events about the probe item id.
func (w *world) events(id uuid.UUID) int {
	w.t.Helper()
	var n int
	if err := w.admin.QueryRow(w.t.Context(), "SELECT count(*) FROM audit_events WHERE entity_id = $1", id).Scan(&n); err != nil {
		w.t.Fatal(err)
	}
	return n
}

// A repeated key is answered with the first response, and the effect happens once: one item,
// one audit event, one change.
func TestARepeatedKeyGetsTheFirstResponse(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Contribute))
	it := idgen.New()
	first := w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("add-milk"))
	expect(t, first, http.StatusCreated, "")
	again := w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("add-milk"))
	expect(t, again, http.StatusCreated, "")
	if again.Body.String() != first.Body.String() || again.Header().Get("Content-Type") != first.Header().Get("Content-Type") {
		t.Fatalf("the repeat answered %q (%s), the first %q (%s)", again.Body, again.Header().Get("Content-Type"),
			first.Body, first.Header().Get("Content-Type"))
	}
	if w.count(it) != 1 || w.events(it) != 1 {
		t.Fatalf("%d items and %d events after a repeat, want one of each", w.count(it), w.events(it))
	}

	// The key is the caller's own: another member who sends it makes their own request.
	other := w.member(h, access.Member, level(access.Contribute))
	mine := idgen.New()
	expect(t, w.send(http.MethodPost, items(h), other, itemBody(mine, h), withKey("add-milk")), http.StatusCreated, "")
	if w.count(mine) != 1 {
		t.Fatal("another member's request with the same key was answered from the first member's")
	}
}

// A repeated delete is answered 204 as the first was: no body, and no Content-Length, which a
// 204 never carries (RFC 9110 §8.6). The item is deleted once.
func TestARepeatedDeleteGetsTheFirst204(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Manage))
	it := w.item(h)
	expect(t, w.send(http.MethodDelete, itemPath(h, it), u, "", withKey("drop")), http.StatusNoContent, "")
	again := w.send(http.MethodDelete, itemPath(h, it), u, "", withKey("drop"))
	expect(t, again, http.StatusNoContent, "")
	if _, ok := again.Header()["Content-Length"]; ok || again.Body.Len() != 0 {
		t.Fatalf("the repeat answered Content-Length %q and %d bytes", again.Header().Get("Content-Length"), again.Body.Len())
	}
	if w.events(it) != 1 {
		t.Fatalf("%d events after a repeated delete, want 1", w.events(it))
	}
}

// A key a row cannot hold is refused, naming the header, on a path no operation has as on one
// an operation has, where the edge refuses it: the edge does not read the headers of a request
// no operation matches, and the key is never claimed, so it cannot fail as a 500.
func TestAKeyThatCannotBeHeldIsRefused(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Contribute))
	for name, tc := range map[string]struct{ key, code string }{
		"too long":  {strings.Repeat("k", 129), "max_length"},
		"not UTF-8": {"k\xff", problem.FieldMalformed},
	} {
		for _, path := range []string{items(h), items(h) + "/elsewhere"} {
			rec := w.send(http.MethodPost, path, u, itemBody(idgen.New(), h), withKey(tc.key))
			var doc struct {
				Errors []problem.FieldError `json:"errors"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &doc); rec.Code != http.StatusUnprocessableEntity || err != nil ||
				!slices.Equal(doc.Errors, []problem.FieldError{{Field: "header:Idempotency-Key", Code: tc.code}}) {
				t.Errorf("a key %s, to %s: %d %s", name, path, rec.Code, rec.Body)
			}
		}
	}
	var keys int
	if err := w.admin.QueryRow(t.Context(), "SELECT count(*) FROM idempotency_keys WHERE user_id = $1", u).Scan(&keys); err != nil || keys != 0 {
		t.Fatalf("%d keys claimed (%v)", keys, err)
	}
	if strings.Contains(w.logs.String(), "idempotency:") {
		t.Fatalf("a refused key was logged as a failure: %s", w.logs)
	}
}

// A keyed body that stops arriving is answered as the edge answers one: refused when the client
// stops sending it, and aborted when its deadline passes, never logged as the server's failure.
// The path is one no operation has, so the body is read here and not at the edge.
func TestAKeyedBodyThatStopsArrivingIsRefused(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Contribute))
	request := func(cause error) *http.Request {
		ctx := auth.WithUser(mutation.WithVia(t.Context(), audit.ViaWeb), u)
		req := httptest.NewRequestWithContext(ctx, http.MethodPost, items(h)+"/elsewhere",
			io.MultiReader(strings.NewReader(`{"id":`), iotest.ErrReader(cause)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "cut")
		return req
	}
	rec := testsupport.ServeContract(t, w.contract, w.router, request(io.ErrUnexpectedEOF))
	expect(t, rec, http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	func() {
		defer func() {
			if v := recover(); v != any(http.ErrAbortHandler) {
				t.Errorf("a body past its deadline: recovered %v, want http.ErrAbortHandler", v)
			}
		}()
		w.router.ServeHTTP(httptest.NewRecorder(), request(os.ErrDeadlineExceeded))
	}()
	if strings.Contains(w.logs.String(), "idempotency:") {
		t.Fatalf("a body that stopped arriving was logged as a failure: %s", w.logs)
	}
}

// A key reused for a different request is refused, naming the header, and does nothing.
func TestAKeyReusedForAnotherRequestIsRefused(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Manage))
	it, other := idgen.New(), idgen.New()
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusCreated, "")
	for name, rec := range map[string]func() int{
		"another body": func() int {
			return w.send(http.MethodPost, items(h), u, itemBody(other, h), withKey("k")).Code
		},
		"another method and path": func() int {
			rec := w.send(http.MethodDelete, itemPath(h, it), u, "", withKey("k"))
			var doc struct {
				Errors []problem.FieldError `json:"errors"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil || len(doc.Errors) != 1 ||
				doc.Errors[0] != (problem.FieldError{Field: "header:Idempotency-Key", Code: problem.FieldInvalid}) {
				t.Errorf("the refusal names %s", rec.Body)
			}
			return rec.Code
		},
	} {
		if code := rec(); code != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d, want 422", name, code)
		}
	}
	if w.count(other) != 0 || w.count(it) != 1 {
		t.Fatal("a reused key's request had an effect")
	}
}

// A refused request stores nothing, so repeating it once the reason has gone runs it.
func TestARefusedRequestStoresNothing(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.View))
	it := idgen.New()
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusForbidden, problem.CodeForbidden)
	w.exec("UPDATE module_grants SET level = 'contribute' WHERE household_id = $1 AND user_id = $2", h, u)
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusCreated, "")
	if w.count(it) != 1 {
		t.Fatal("the repeat after the grant was raised did not run")
	}
}

// A repeat that finds its key held by a request still running is answered 409, and runs
// nothing. A claim past its lease belonged to a request that ended without committing, and a
// repeat takes it over and runs; a key whose effect committed is never run again, response or
// not.
func TestAKeyInProgressIsNotRunTwice(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Contribute))
	it := idgen.New()
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusCreated, "")
	key := "household_id = $1 AND user_id = $2 AND key = 'k'"

	// The first request is still running, before its effect committed.
	w.exec("UPDATE idempotency_keys SET state = 'in_flight', status = NULL, header = NULL, body = NULL WHERE "+key, h, u)
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusConflict, problem.CodeIdempotencyInProgress)

	// It died there: past the lease, a repeat takes the key and runs.
	w.exec("DELETE FROM probe_items WHERE id = $1", it)
	w.exec("UPDATE idempotency_keys SET claimed_at = now() - interval '6 minutes' WHERE "+key, h, u)
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusCreated, "")
	if w.count(it) != 1 {
		t.Fatal("the repeat that took the key over did not run")
	}

	// It died after its effect committed and before its response was stored: never again.
	w.exec("UPDATE idempotency_keys SET state = 'committed', status = NULL, header = NULL, body = NULL, "+
		"claimed_at = now() - interval '1 day' WHERE "+key, h, u)
	w.exec("DELETE FROM probe_items WHERE id = $1", it)
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusConflict, problem.CodeIdempotencyInProgress)
	if w.count(it) != 0 {
		t.Fatal("a key whose effect committed ran again")
	}

	// A key past its 7 days is a new key.
	w.exec("UPDATE idempotency_keys SET created_at = now() - interval '8 days' WHERE "+key, h, u)
	expect(t, w.send(http.MethodPost, items(h), u, itemBody(it, h), withKey("k")), http.StatusCreated, "")
}

// endless is a request body that never ends, and counts how much of it was read.
type endless struct{ read int64 }

func (e *endless) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	e.read += int64(len(p))
	return len(p), nil
}

// A keyed request whose body the edge did not bound, because no operation matches it, is not
// read past the edge's limit to tell it from another request: a member cannot make the server
// hold a body of any size.
func TestAKeyedBodyIsBounded(t *testing.T) {
	w := newWorld(t)
	h := w.household(true)
	u := w.member(h, access.Member, level(access.Contribute))
	for name, target := range map[string]struct{ method, path string }{
		"a path no operation has":          {http.MethodPost, items(h) + "/elsewhere"},
		"a method the operation lacks":     {http.MethodPut, items(h)},
		"a method the item route lacks":    {http.MethodPatch, itemPath(h, idgen.New())},
		"a body the operation would bound": {http.MethodPost, items(h)},
	} {
		t.Run(name, func(t *testing.T) {
			body := &endless{}
			ctx := auth.WithUser(mutation.WithVia(t.Context(), audit.ViaWeb), u)
			req := httptest.NewRequestWithContext(ctx, target.method, target.path, io.LimitReader(body, 64<<20))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "big")
			rec := testsupport.ServeContract(t, w.contract, w.router, req)
			expect(t, rec, http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)
			// The limit is 1 KiB; a reader may ask for a buffer's worth past it.
			if body.read > 64<<10 {
				t.Fatalf("read %d bytes of the body", body.read)
			}
		})
	}
}
