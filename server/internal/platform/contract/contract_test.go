package contract_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

const (
	household   = "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90"
	other       = "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a91"
	maxBody     = 1 << 10
	bodyTimeout = 300 * time.Millisecond
)

func load(t *testing.T) *contract.Contract {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatalf("load the contract: %v", err)
	}
	return c
}

func TestTheCommittedContractLoads(t *testing.T) {
	c := load(t)
	if n := len(c.Operations()); n < 486 {
		t.Fatalf("%d operations; the contract declares at least 486", n)
	}
	o, ok := c.ByID("getHealthz")
	if !ok || o.Method != http.MethodGet || o.Path != "/healthz" {
		t.Fatalf("getHealthz = %+v, %t", o, ok)
	}
	if _, ok := c.Lookup(http.MethodPost, "/households/{household_id}/shopping/lists"); !ok {
		t.Fatal("Lookup did not find postShoppingLists")
	}
}

func TestParseRefusesOperationsItCannotName(t *testing.T) {
	for name, paths := range map[string]string{
		"no operationId":         "  /a:\n    get:\n      responses: {'200': {description: ok}}\n",
		"duplicated operationId": "  /a:\n    get: {operationId: x, responses: {'200': {description: ok}}}\n  /b:\n    get: {operationId: x, responses: {'200': {description: ok}}}\n",
	} {
		t.Run(name, func(t *testing.T) {
			spec := "openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths:\n" + paths
			if _, err := contract.Parse([]byte(spec)); err == nil {
				t.Fatal("Parse succeeded")
			}
		})
	}
}

// recorder is what a test route saw.
type recorder struct {
	body   []byte
	query  string
	called bool
}

// router mounts the edge validator over a handful of the contract's real operations.
func router(t *testing.T) (http.Handler, *recorder) {
	t.Helper()
	c := load(t)
	seen := &recorder{}
	handle := func(w http.ResponseWriter, r *http.Request) {
		seen.called = true
		seen.body, _ = io.ReadAll(r.Body)
		seen.query = r.URL.RawQuery
		w.WriteHeader(http.StatusNoContent)
	}
	api := chi.NewRouter()
	api.Use(c.Middleware(api, contract.Limits{MaxBody: maxBody}))
	api.Put("/me/consents", handle)
	api.Post("/auth/password-reset", handle)
	api.Post("/households/{household_id}/shopping/lists", handle)
	api.Patch("/households/{household_id}/shopping/lists/{list_id}", handle)
	api.Get("/households/{household_id}/garden/harvests", handle)
	api.Post("/households/{household_id}/garden/harvests", handle)
	api.Post("/households/{household_id}/notes/{note_id}/move", handle)
	api.Post("/households/{household_id}/notes/{note_id}/images", handle)
	api.Post("/households/{household_id}/finance/rules/apply", handle)
	root := chi.NewRouter()
	root.Mount(contract.BasePath, api)
	return root, seen
}

type call struct {
	method, path, contentType, body string
	header                          map[string]string
}

func (c call) do(t *testing.T, h http.Handler) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if c.body != "" {
		body = strings.NewReader(c.body)
	}
	req := httptest.NewRequestWithContext(t.Context(), c.method, contract.BasePath+c.path, body)
	if c.contentType != "" {
		req.Header.Set("Content-Type", c.contentType)
	}
	for k, v := range c.header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// fieldErrors decodes a 422 and returns its errors.
func fieldErrors(t *testing.T, rec *httptest.ResponseRecorder) []problem.FieldError {
	t.Helper()
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", rec.Code, rec.Body.String())
	}
	var doc struct {
		Code   string               `json:"code"`
		Errors []problem.FieldError `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if doc.Code != "validation_failed" {
		t.Fatalf("code %q, want validation_failed", doc.Code)
	}
	if err := load(t).ValidateResponse(httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), "", nil, rec.Code, rec.Header(), rec.Body.Bytes()); err != nil {
		t.Fatalf("the 422 is not a valid ValidationProblem: %v", err)
	}
	return doc.Errors
}

func sameErrors(t *testing.T, got []problem.FieldError, want ...problem.FieldError) {
	t.Helper()
	sort := func(s []problem.FieldError) {
		slices.SortFunc(s, func(a, b problem.FieldError) int {
			return strings.Compare(a.Field+" "+a.Code, b.Field+" "+b.Code)
		})
	}
	sort(got)
	sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("errors %v, want %v", got, want)
	}
}

const lists = "/households/" + household + "/shopping/lists"

// The item's Done-when: an invalid body returns 422 with a problem code.
func TestAnInvalidBodyIs422NamingEachField(t *testing.T) {
	h, seen := router(t)
	rec := call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"name": 5}`}.do(t, h)
	sameErrors(t, fieldErrors(t, rec),
		problem.FieldError{Field: "/name", Code: "type"},
		problem.FieldError{Field: "/id", Code: "required"},
	)
	if seen.called {
		t.Fatal("the handler ran on an invalid body")
	}
}

func TestAValidBodyReachesTheHandlerAsSent(t *testing.T) {
	h, seen := router(t)
	body := `{"id":"` + other + `","name":"Groceries"}`
	// Media types are case-insensitive (RFC 9110 §8.3.1), and a parameter's ';' may have
	// whitespace around it (§5.6.6).
	for _, contentType := range []string{"application/json; charset=utf-8", "Application/JSON; charset=UTF-8", "application/json ; charset=utf-8"} {
		seen.body = nil
		rec := call{method: http.MethodPost, path: lists, contentType: contentType, body: body}.do(t, h)
		if rec.Code != http.StatusNoContent || string(seen.body) != body {
			t.Fatalf("%s: status %d, handler saw %q", contentType, rec.Code, seen.body)
		}
	}
}

// A client that sends back the object it read, readOnly members and all, is not refused
// for them: the members are still validated, and the handler ignores them. putMeConsents
// takes Consents, whose updated_at is readOnly.
func TestAReadOnlyMemberSentBackIsValidatedNotRefused(t *testing.T) {
	h, seen := router(t)
	body := `{"analytics":true,"marketing_email":false,"updated_at":"2026-09-27T08:15:00Z"}`
	rec := call{method: http.MethodPut, path: "/me/consents", contentType: "application/json", body: body}.do(t, h)
	if rec.Code != http.StatusNoContent || string(seen.body) != body {
		t.Fatalf("status %d %s, handler saw %q", rec.Code, rec.Body.String(), seen.body)
	}
	rec = call{method: http.MethodPut, path: "/me/consents", contentType: "application/json", body: `{"updated_at":5}`}.do(t, h)
	sameErrors(t, fieldErrors(t, rec), problem.FieldError{Field: "/updated_at", Code: "type"})
}

// kin-openapi marks the failures inside an allOf with the allOf's own path, so one below
// the root is named once: /items/1/x, never /items/1/items/1/x. No request body in the
// committed contract nests an allOf yet, so the fixture does.
func TestAnAllOfBelowTheRootIsNamedAtItsOwnPointer(t *testing.T) {
	c, err := contract.Parse([]byte(`openapi: 3.1.0
info: {title: t, version: '1'}
paths:
  /things:
    post:
      operationId: postThings
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                one: { $ref: '#/components/schemas/ThingCreate' }
                items: { type: array, items: { $ref: '#/components/schemas/ThingCreate' } }
      responses: { '204': { description: Created } }
components:
  schemas:
    ThingUpdate: { type: object, properties: { name: { type: string } } }
    ThingCreate:
      allOf:
        - { $ref: '#/components/schemas/ThingUpdate' }
        - { required: [name] }
`))
	if err != nil {
		t.Fatal(err)
	}
	api := chi.NewRouter()
	api.Use(c.Middleware(api, contract.Limits{MaxBody: maxBody}))
	api.Post("/things", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	root := chi.NewRouter()
	root.Mount(contract.BasePath, api)

	for body, want := range map[string]problem.FieldError{
		`{"one":{}}`:                          {Field: "/one/name", Code: "required"},
		`{"items":[{"name":"a"},{}]}`:         {Field: "/items/1/name", Code: "required"},
		`{"items":[{"name":"a"},{"name":5}]}`: {Field: "/items/1/name", Code: "type"},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, contract.BasePath+"/things", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		root.ServeHTTP(rec, req)
		sameErrors(t, fieldErrors(t, rec), want)
	}
}

// A client that trickles a JSON body is disconnected once the body is overdue, rather than
// holding the connection for as long as it likes. The server's own middleware wraps the
// writer, so the deadline reaches the connection through Unwrap.
func TestAJSONBodyThatDoesNotArriveInTimeIsCutOff(t *testing.T) {
	h, seen := router(t)
	log := logging.New(io.Discard, slog.LevelError)
	srv := httptest.NewServer(httpx.AccessLog(log)(httpx.Recover(log)(httpx.BodyDeadline(bodyTimeout)(h))))
	defer srv.Close()
	conn, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	_, err = io.WriteString(conn, "POST "+contract.BasePath+lists+" HTTP/1.1\r\nHost: test\r\n"+
		"Content-Type: application/json\r\nContent-Length: 64\r\n\r\n{\"id\":")
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(10 * bodyTimeout))
	start := time.Now()
	got, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("the connection was not closed: %v", err)
	}
	if len(got) != 0 || seen.called {
		t.Fatalf("the server answered %q; handler ran %t", got, seen.called)
	}
	if elapsed := time.Since(start); elapsed < bodyTimeout/2 {
		t.Fatalf("closed after %s, before the body was overdue", elapsed)
	}
}

// The body's deadline ends with the body: a handler that runs past it keeps its request's
// context, which net/http cancels when a deadline reaches the read it keeps open to notice
// the client leaving. net/http clears the deadline as it starts that read, once the edge has
// read a body to its end; with no body the read starts at once, so no deadline may be set.
// postFinanceRulesApply's body is optional, so it is tried with one and without.
func TestTheBodyDeadlineDoesNotOutliveTheBody(t *testing.T) {
	api := chi.NewRouter()
	api.Use(load(t).Middleware(api, contract.Limits{MaxBody: maxBody}))
	api.Post("/households/{household_id}/finance/rules/apply", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(3 * bodyTimeout):
			w.WriteHeader(http.StatusNoContent)
		case <-r.Context().Done():
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	})
	root := chi.NewRouter()
	root.Use(httpx.BodyDeadline(bodyTimeout))
	root.Mount(contract.BasePath, api)
	srv := httptest.NewServer(root)
	defer srv.Close()

	for _, body := range []string{`{"dry_run":true}`, ""} {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			srv.URL+contract.BasePath+"/households/"+household+"/finance/rules/apply", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("body %q: status %d; the handler's context ended with the body's deadline", body, resp.StatusCode)
		}
	}
}

// kin-openapi writes schema defaults into the request unless told not to. A handler must
// read what the client sent: a PATCH that grew defaulted members would overwrite fields the
// client never mentioned. postFinanceRulesApply defaults dry_run and only_uncategorised to
// true in its body, and the Limit parameter defaults to 50.
func TestTheRequestIsNotRewrittenWithDefaults(t *testing.T) {
	h, seen := router(t)
	rec := call{method: http.MethodPost, path: "/households/" + household + "/finance/rules/apply", contentType: "application/json", body: `{}`}.do(t, h)
	if rec.Code != http.StatusNoContent || string(seen.body) != `{}` {
		t.Fatalf("status %d, handler saw %q", rec.Code, seen.body)
	}
	rec = call{method: http.MethodGet, path: "/households/" + household + "/garden/harvests"}.do(t, h)
	if rec.Code != http.StatusNoContent || seen.query != "" {
		t.Fatalf("status %d, handler saw the query %q", rec.Code, seen.query)
	}
}

// A body that is not a JSON text is malformed, however valid its first value: kin-openapi's
// own decoder reads only that value, and would hand the rest to the handler unvalidated. So
// is a string PostgreSQL cannot store as sent: an escaped NUL, which a text column refuses,
// or half a surrogate pair, which Go reads as U+FFFD.
func TestMalformedAndMissingBodies(t *testing.T) {
	h, seen := router(t)
	valid := `{"id":"` + other + `","name":"x"}`
	named := func(name string) call {
		return call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `","name":"` + name + `"}`}
	}
	for name, tc := range map[string]struct {
		c    call
		want problem.FieldError
	}{
		"not JSON":                 {call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"name":`}, problem.FieldError{Field: "", Code: "malformed"}},
		"data after it":            {call{method: http.MethodPost, path: lists, contentType: "application/json", body: valid + ` x`}, problem.FieldError{Field: "", Code: "malformed"}},
		"a second value":           {call{method: http.MethodPost, path: lists, contentType: "application/json", body: valid + `{"name":5}`}, problem.FieldError{Field: "", Code: "malformed"}},
		"bytes not UTF-8":          {call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `","name":"x` + "\xff" + `"}`}, problem.FieldError{Field: "", Code: "malformed"}},
		"no body":                  {call{method: http.MethodPost, path: lists, contentType: "application/json"}, problem.FieldError{Field: "", Code: "required"}},
		"no header":                {call{method: http.MethodPost, path: lists}, problem.FieldError{Field: "", Code: "required"}},
		"whitespace only":          {call{method: http.MethodPost, path: lists, contentType: "application/json", body: " \n"}, problem.FieldError{Field: "", Code: "malformed"}},
		"an escaped NUL":           {named(`a\u0000b`), problem.FieldError{Field: "", Code: "malformed"}},
		"a high half":              {named(`a\ud83d`), problem.FieldError{Field: "", Code: "malformed"}},
		"a low half":               {named(`\ude00a`), problem.FieldError{Field: "", Code: "malformed"}},
		"halves reversed":          {named(`\ude00\ud83d`), problem.FieldError{Field: "", Code: "malformed"}},
		"a high half and a letter": {named(`\ud83d\u0041`), problem.FieldError{Field: "", Code: "malformed"}},
	} {
		t.Run(name, func(t *testing.T) {
			seen.called = false
			sameErrors(t, fieldErrors(t, tc.c.do(t, h)), tc.want)
			if seen.called {
				t.Fatal("the handler ran")
			}
		})
	}
	// Whitespace around the one value is part of a JSON text.
	if rec := (call{method: http.MethodPost, path: lists, contentType: "application/json", body: " " + valid + "\n"}).do(t, h); rec.Code != http.StatusNoContent {
		t.Fatalf("a valid body with whitespace around it: %d %s", rec.Code, rec.Body.String())
	}
	// A whole pair is a character, and an escaped backslash escapes no u after it.
	for _, name := range []string{`\ud83d\ude00`, `\\u0000`, `\u00e9\"\\`} {
		if rec := named(name).do(t, h); rec.Code != http.StatusNoContent {
			t.Fatalf("the name %s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
}

func TestABodyInAnUndeclaredMediaTypeIs415(t *testing.T) {
	h, seen := router(t)
	for name, c := range map[string]call{
		"text/plain":        {method: http.MethodPost, path: lists, contentType: "text/plain", body: "Groceries"},
		"merge-patch":       {method: http.MethodPatch, path: lists + "/" + other, contentType: "application/merge-patch+json", body: `{}`},
		"no Content-Type":   {method: http.MethodPost, path: lists, body: `{"id":"` + other + `","name":"x"}`},
		"unparsable":        {method: http.MethodPost, path: lists, contentType: "application/", body: `{}`},
		"multipart on JSON": {method: http.MethodPost, path: lists, contentType: "multipart/form-data; boundary=x", body: "--x--"},
	} {
		t.Run(name, func(t *testing.T) {
			rec := c.do(t, h)
			if rec.Code != http.StatusUnsupportedMediaType || !strings.Contains(rec.Body.String(), `"code":"unsupported_media_type"`) {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
		})
	}
	if seen.called {
		t.Fatal("a handler ran")
	}
}

func TestAJSONBodyOverTheCapIs413(t *testing.T) {
	h, seen := router(t)
	name := strings.Repeat("x", maxBody)
	rec := call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `","name":"` + name + `"}`}.do(t, h)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), `"code":"payload_too_large"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if seen.called {
		t.Fatal("the handler ran")
	}
}

// counting is a request body that counts the bytes read from it.
type counting struct {
	r    io.Reader
	read int
}

func (c *counting) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.read += n
	return n, err
}

// An upload is streamed by its handler, which applies its own cap; the JSON cap and the
// JSON validator stay out of its way, and the edge reads none of it. The operation is
// secured, as every one but the probes is, and kin-openapi reads a body whole to check a
// security requirement.
func TestAMultipartUploadIsLeftToItsHandler(t *testing.T) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "photo.jpg")
	_, _ = part.Write(bytes.Repeat([]byte{0xff}, 4*maxBody))
	_ = form.Close()
	size := body.Len()
	upload := &counting{r: &body}

	api := chi.NewRouter()
	api.Use(load(t).Middleware(api, contract.Limits{MaxBody: maxBody}))
	readBefore, handled := -1, 0
	api.Post("/households/{household_id}/notes/{note_id}/images", func(w http.ResponseWriter, r *http.Request) {
		readBefore = upload.read
		b, _ := io.ReadAll(r.Body)
		handled = len(b)
		w.WriteHeader(http.StatusNoContent)
	})
	root := chi.NewRouter()
	root.Mount(contract.BasePath, api)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost,
		contract.BasePath+"/households/"+household+"/notes/"+other+"/images", upload)
	req.Header.Set("Content-Type", form.FormDataContentType())
	rec := httptest.NewRecorder()
	root.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || readBefore != 0 || handled != size {
		t.Fatalf("status %d; the edge read %d bytes before the handler, which saw %d of %d", rec.Code, readBefore, handled, size)
	}
}

func TestParametersAreValidated(t *testing.T) {
	h, _ := router(t)
	harvests := "/households/" + household + "/garden/harvests"
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?limit=500"}.do(t, h)),
		problem.FieldError{Field: "query:limit", Code: "maximum"})
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?season_year=soon"}.do(t, h)),
		problem.FieldError{Field: "query:season_year", Code: "malformed"})
	// An empty integer does not parse either; the schema has no length to fall short of.
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?limit="}.do(t, h)),
		problem.FieldError{Field: "query:limit", Code: "malformed"})
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: "/households/not-a-uuid/garden/harvests"}.do(t, h)),
		problem.FieldError{Field: "path:household_id", Code: "pattern"})
	sameErrors(t, fieldErrors(t, call{
		method: http.MethodPatch, path: lists + "/" + other, contentType: "application/json", body: `{}`,
		header: map[string]string{"If-Match": "42"},
	}.do(t, h)), problem.FieldError{Field: "header:If-Match", Code: "pattern"})
	sameErrors(t, fieldErrors(t, call{
		method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `","name":"x"}`,
		header: map[string]string{"Idempotency-Key": strings.Repeat("k", 129)},
	}.do(t, h)), problem.FieldError{Field: "header:Idempotency-Key", Code: "max_length"})

	// net/url drops a pair it cannot parse without a word; a cursor dropped that way
	// would be answered with page one (PRD 01 §6).
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?cursor=a;b"}.do(t, h)),
		problem.FieldError{Field: "query:cursor", Code: "malformed"})
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?limit=%zz&season_year=2026"}.do(t, h)),
		problem.FieldError{Field: "query:limit", Code: "malformed"})

	// Text PostgreSQL cannot store, U+0000 or bytes that are not UTF-8, is malformed in a
	// parameter as it is in a body: the handler's query would otherwise fail as a 500.
	for query, field := range map[string]string{"cursor=%00": "query:cursor", "cursor=a%FFb": "query:cursor", "%00=x": "query:%00"} {
		sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?" + query}.do(t, h)),
			problem.FieldError{Field: field, Code: "malformed"})
	}
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: "/households/%00/garden/harvests"}.do(t, h)),
		problem.FieldError{Field: "path:household_id", Code: "malformed"})
	sameErrors(t, fieldErrors(t, call{
		method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `","name":"x"}`,
		header: map[string]string{"Idempotency-Key": "key-\xff"},
	}.do(t, h)), problem.FieldError{Field: "header:Idempotency-Key", Code: "malformed"})

	if rec := (call{method: http.MethodGet, path: harvests + "?limit=200&season_year=2026"}).do(t, h); rec.Code != http.StatusNoContent {
		t.Fatalf("valid parameters: %d %s", rec.Code, rec.Body.String())
	}
}

// The body is refused by its framing, unread: an operation that takes none has no cap to
// read one under. A chunked body, whose length is unknown (-1), is refused as surely as one
// with a Content-Length.
func TestABodyOnAnOperationThatTakesNoneIs422(t *testing.T) {
	for _, length := range []int64{64 * maxBody, -1} {
		h, seen := router(t)
		body := &counting{r: strings.NewReader(strings.Repeat("x", 64*maxBody))}
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, contract.BasePath+"/households/"+household+"/garden/harvests", body)
		req.ContentLength = length
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		sameErrors(t, fieldErrors(t, rec), problem.FieldError{Field: "", Code: "invalid"})
		if seen.called || body.read != 0 {
			t.Fatalf("length %d: the handler ran %t; the edge read %d bytes", length, seen.called, body.read)
		}
	}
}

// A route whose parameter carries a regular expression is validated against the operation
// whose path it serves, as architecture test 6 matches it.
func TestARouteWithAParameterPatternIsValidated(t *testing.T) {
	api := chi.NewRouter()
	api.Use(load(t).Middleware(api, contract.Limits{MaxBody: maxBody}))
	api.Post("/households/{household_id:[0-9a-f-]+}/shopping/lists", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	root := chi.NewRouter()
	root.Mount(contract.BasePath, api)

	rec := call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `","name":"x"}`}.do(t, root)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("a valid body: %d %s", rec.Code, rec.Body.String())
	}
	rec = call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"id":"` + other + `"}`}.do(t, root)
	sameErrors(t, fieldErrors(t, rec), problem.FieldError{Field: "/name", Code: "required"})
}

// A parameter's regular expression may hold braces of its own, which chi matches by depth.
func TestFind(t *testing.T) {
	api := chi.NewRouter()
	noop := func(http.ResponseWriter, *http.Request) {}
	api.Get("/households/{household_id:[0-9a-f]{8}-[0-9a-f-]{27}}/notes/{note_id}", noop)
	root := chi.NewRouter()
	root.Mount(contract.BasePath, api)

	note := "/households/" + household + "/notes/" + other
	for name, tc := range map[string]struct {
		router chi.Routes
		path   string
	}{
		"below the mount point": {api, note},
		"from the root":         {root, contract.BasePath + note},
	} {
		t.Run(name, func(t *testing.T) {
			m, ok := contract.Find(tc.router, http.MethodGet, tc.path)
			if !ok || m.Path != "/households/{household_id}/notes/{note_id}" ||
				len(m.Params) != 2 || m.Params["household_id"] != household || m.Params["note_id"] != other {
				t.Fatalf("Find = %+v, %t", m, ok)
			}
		})
	}
	if _, ok := contract.Find(root, http.MethodPost, contract.BasePath+note); ok {
		t.Error("Find matched a method the route does not serve")
	}
	// chi's lookup reports the mount point as a route of every method; it is none.
	for _, path := range []string{contract.BasePath, contract.BasePath + "/"} {
		if m, ok := contract.Find(root, http.MethodGet, path); ok {
			t.Errorf("Find matched the mount point %s: %+v", path, m)
		}
	}
}

// A router mounted inside the API, as a group of routes behind middleware of their own, has
// a mount point chi's lookup reports as a route of every method. It is no operation: any
// method on it is routed below it and answered 404, neither validated as an operation it is
// not nor refused as a route the contract does not declare. A method the routes below it do
// not serve is a 405 naming those they do: chi hands the API's 405 handler on to the router
// mounted there, which routes by what is left of the path.
func TestAMountPointIsNoRoute(t *testing.T) {
	api := chi.NewRouter()
	api.Use(load(t).Middleware(api, contract.Limits{MaxBody: maxBody}))
	api.NotFound(httpx.NotFound)
	api.MethodNotAllowed(httpx.MethodNotAllowed)
	api.Route("/households/{household_id}", func(r chi.Router) {
		r.Get("/garden/harvests", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	})
	root := chi.NewRouter()
	root.NotFound(httpx.NotFound)
	root.MethodNotAllowed(httpx.MethodNotAllowed)
	root.Mount(contract.BasePath, api)

	for _, method := range []string{http.MethodGet, http.MethodPut, "PROPFIND"} {
		rec := call{method: method, path: "/households/" + household}.do(t, root)
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"not_found"`) || rec.Header().Get("Allow") != "" {
			t.Errorf("%s on the mount point: %d, Allow %q, %s", method, rec.Code, rec.Header().Get("Allow"), rec.Body.String())
		}
	}
	// The routes below it are validated as ever.
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: "/households/" + household + "/garden/harvests?limit=500"}.do(t, root)),
		problem.FieldError{Field: "query:limit", Code: "maximum"})
	rec := call{method: http.MethodDelete, path: "/households/" + household + "/garden/harvests"}.do(t, root)
	if rec.Code != http.StatusMethodNotAllowed || !strings.Contains(rec.Body.String(), `"code":"method_not_allowed"`) || rec.Header().Get("Allow") != "GET" {
		t.Errorf("DELETE on a GET route below the mount point: %d, Allow %q, %s", rec.Code, rec.Header().Get("Allow"), rec.Body.String())
	}
}

// The OpenAPI 3.1 constructs this contract uses, each checked by the built-in validator
// the validating view selects (contract.go, newValidatingView).
func TestTheOpenAPI31ConstructsTheContractUses(t *testing.T) {
	h, _ := router(t)
	harvests := "/households/" + household + "/garden/harvests"
	move := "/households/" + household + "/notes/" + other + "/move"
	harvest := func(quantity string) string {
		return `{"id":"` + other + `","planting_id":"` + other + `","harvested_on":"2026-09-27","quantity":` + quantity + `}`
	}
	for name, tc := range map[string]struct {
		c    call
		want []problem.FieldError // nil: accepted
	}{
		"type array admits null": {call{method: http.MethodPatch, path: lists + "/" + other, body: `{"icon":null,"store":"Albert"}`}, nil},
		"type array refuses a number": {call{method: http.MethodPatch, path: lists + "/" + other, body: `{"icon":3}`},
			[]problem.FieldError{{Field: "/icon", Code: "type"}}},
		"a type without null refuses null": {call{method: http.MethodPost, path: lists, body: `{"id":"` + other + `","name":null}`},
			[]problem.FieldError{{Field: "/name", Code: "type"}}},
		"exclusiveMinimum admits above": {call{method: http.MethodPost, path: harvests, body: harvest("0.5")}, nil},
		"exclusiveMinimum refuses the bound": {call{method: http.MethodPost, path: harvests, body: harvest("0")},
			[]problem.FieldError{{Field: "/quantity", Code: "exclusive_minimum"}}},
		"allOf required": {call{method: http.MethodPost, path: harvests, body: `{"id":"` + other + `"}`},
			[]problem.FieldError{{Field: "/planting_id", Code: "required"}, {Field: "/harvested_on", Code: "required"}, {Field: "/quantity", Code: "required"}}},
		"date format": {call{method: http.MethodPost, path: harvests, body: strings.Replace(harvest("1"), "2026-09-27", "27.9.2026", 1)},
			[]problem.FieldError{{Field: "/harvested_on", Code: "format"}}},
		"oneOf admits null":     {call{method: http.MethodPost, path: move, body: `{"folder_id":null}`}, nil},
		"oneOf admits a uuid":   {call{method: http.MethodPost, path: move, body: `{"folder_id":"` + other + `"}`}, nil},
		"oneOf refuses neither": {call{method: http.MethodPost, path: move, body: `{"folder_id":"root"}`}, []problem.FieldError{{Field: "/folder_id", Code: "one_of"}}},
	} {
		t.Run(name, func(t *testing.T) {
			tc.c.contentType = "application/json"
			rec := tc.c.do(t, h)
			if tc.want == nil {
				if rec.Code != http.StatusNoContent {
					t.Fatalf("refused: %d %s", rec.Code, rec.Body.String())
				}
				return
			}
			sameErrors(t, fieldErrors(t, rec), tc.want...)
		})
	}
}

// kin-openapi's own check of a date is a regular expression, which takes a day the month does
// not have and an offset no zone has. PostgreSQL refuses both, so the edge does.
func TestADateIsADayOnTheCalendar(t *testing.T) {
	h, _ := router(t)
	harvests := "/households/" + household + "/garden/harvests"
	harvest := func(on string) call {
		return call{method: http.MethodPost, path: harvests, contentType: "application/json",
			body: `{"id":"` + other + `","planting_id":"` + other + `","harvested_on":"` + on + `","quantity":1}`}
	}
	consents := func(at string) call {
		return call{method: http.MethodPut, path: "/me/consents", contentType: "application/json", body: `{"updated_at":"` + at + `"}`}
	}
	for _, on := range []string{"2026-02-30", "2025-02-29", "2026-04-31"} {
		sameErrors(t, fieldErrors(t, harvest(on).do(t, h)), problem.FieldError{Field: "/harvested_on", Code: "format"})
	}
	// RFC 3339's grammar still holds: a comma before the fraction is Go's leniency, not the RFC's.
	for _, at := range []string{"2026-02-30T08:15:00Z", "2026-09-27T08:15:00+99:00", "2026-09-27T08:15:00,5Z"} {
		sameErrors(t, fieldErrors(t, consents(at).do(t, h)), problem.FieldError{Field: "/updated_at", Code: "format"})
	}
	for _, c := range []call{harvest("2028-02-29"), consents("2026-09-27T08:15:00.123456+02:00")} {
		if rec := c.do(t, h); rec.Code != http.StatusNoContent {
			t.Fatalf("%s: %d %s", c.body, rec.Code, rec.Body.String())
		}
	}
}

// kin-openapi does not check `format: email` at all by default; the edge holds it to a bare
// address that SMTP can carry, as the server checks one everywhere it takes one.
func TestAnEmailIsAnAddress(t *testing.T) {
	h, _ := router(t)
	reset := func(email string) call {
		body, err := json.Marshal(map[string]string{"email": email})
		if err != nil {
			t.Fatal(err)
		}
		return call{method: http.MethodPost, path: "/auth/password-reset", contentType: "application/json", body: string(body)}
	}
	for _, bad := range []string{
		"", "jana", "jana@", "@tilcerovi.cz", "Jana <jana@tilcerovi.cz>", " jana@tilcerovi.cz", "jana@tilcerovi.cz ",
		"jana@tilcerovi.cz\r\nBcc: x@y.z", "jana(home)@tilcerovi.cz", strings.Repeat("a", 250) + "@b.cz",
		// 168 characters, but 268 octets, which is what SMTP counts.
		strings.Repeat("a", 64) + "@" + strings.Repeat("ž", 100) + ".cz",
		// A part before the @ longer than SMTP's 64 octets, in characters or in octets alone.
		strings.Repeat("a", 65) + "@example.com", strings.Repeat("ž", 33) + "@example.cz",
		// An address in brackets, which would have the relay deliver to a host the caller chose.
		"jana@[192.0.2.1]", "jana@[IPv6:2001:db8::1]",
	} {
		sameErrors(t, fieldErrors(t, reset(bad).do(t, h)), problem.FieldError{Field: "/email", Code: "format"})
	}
	for _, good := range []string{"jana@tilcerovi.cz", "Jana.Tilcerova+home@tilcerovi.cz", "miloš@example.cz", strings.Repeat("a", 64) + "@example.com"} {
		if rec := reset(good).do(t, h); rec.Code != http.StatusNoContent {
			t.Errorf("%q: %d %s", good, rec.Code, rec.Body.String())
		}
	}
}

func TestARequestNoRouteMatchesPassesThrough(t *testing.T) {
	h, _ := router(t)
	for _, c := range []call{
		{method: http.MethodGet, path: "/no/such/path"},
		{method: http.MethodDelete, path: lists, contentType: "text/plain", body: "x"},
	} {
		if rec := c.do(t, h); rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s: %d %s", c.method, c.path, rec.Code, rec.Body.String())
		}
	}
}

func TestValidateResponse(t *testing.T) {
	c := load(t)
	get := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/healthz", nil)
	jsonHeader := http.Header{"Content-Type": []string{"application/json"}}
	problemHeader := http.Header{"Content-Type": []string{problem.ContentType}}

	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusOK, jsonHeader, []byte(`{"status":"ok"}`)); err != nil {
		t.Errorf("a valid liveness response: %v", err)
	}
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusOK, jsonHeader, []byte(`{"status":"fine"}`)); err == nil {
		t.Error("a body that breaks `const: ok` passed")
	}
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusOK, jsonHeader, []byte(`{"status":"ok"}{"status":"ok"}`)); err == nil {
		t.Error("a body of two JSON values passed")
	}
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusTeapot, jsonHeader, []byte(`{}`)); err == nil {
		t.Error("an undeclared status passed")
	}
	internal := []byte(`{"type":"urn:household:problem:internal","title":"Internal Server Error","status":500,"code":"internal"}`)
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusInternalServerError, problemHeader, internal); err != nil {
		t.Errorf("a protocol-level 500: %v", err)
	}
	// 413 and 415 refuse a body, which getHealthz does not take; postShoppingLists does.
	unsupported := []byte(`{"type":"urn:household:problem:unsupported_media_type","title":"Unsupported Media Type","status":415,"code":"unsupported_media_type"}`)
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusUnsupportedMediaType, problemHeader, unsupported); err == nil {
		t.Error("a 415 from an operation that takes no body passed")
	}
	post := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1"+lists, nil)
	if err := c.ValidateResponse(post, "/households/{household_id}/shopping/lists", map[string]string{"household_id": household},
		http.StatusUnsupportedMediaType, problemHeader, unsupported); err != nil {
		t.Errorf("a 415 from an operation that takes a body: %v", err)
	}
	// A repeated Idempotency-Key's 409 is any operation's that accepts the key, whatever 409 it
	// declares for its own conflicts, and no other's.
	inProgress := []byte(`{"type":"urn:household:problem:idempotency_in_progress","title":"Conflict","status":409,"code":"idempotency_in_progress"}`)
	if err := c.ValidateResponse(post, "/households/{household_id}/shopping/lists", map[string]string{"household_id": household},
		http.StatusConflict, problemHeader, inProgress); err != nil {
		t.Errorf("a 409 idempotency_in_progress from an operation that accepts Idempotency-Key: %v", err)
	}
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusConflict, problemHeader, inProgress); err == nil {
		t.Error("a 409 idempotency_in_progress from an operation that does not accept Idempotency-Key passed")
	}
	if err := c.ValidateResponse(post, "/households/{household_id}/shopping/lists", map[string]string{"household_id": household},
		http.StatusBadRequest, problemHeader, inProgress); err == nil {
		t.Error("an idempotency_in_progress answered with another status passed")
	}
	// A CSRF refusal is any unsafe operation's 403, whether or not it declares one, and no safe
	// operation's.
	csrf := []byte(`{"type":"urn:household:problem:csrf_failed","title":"Forbidden","status":403,"code":"csrf_failed"}`)
	if err := c.ValidateResponse(post, "/households/{household_id}/shopping/lists", map[string]string{"household_id": household},
		http.StatusForbidden, problemHeader, csrf); err != nil {
		t.Errorf("a 403 csrf_failed from an unsafe operation: %v", err)
	}
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusForbidden, problemHeader, csrf); err == nil {
		t.Error("a 403 csrf_failed from a safe operation passed")
	}
	if err := c.ValidateResponse(post, "/households/{household_id}/shopping/lists", map[string]string{"household_id": household},
		http.StatusUnauthorized, problemHeader, csrf); err == nil {
		t.Error("a csrf_failed answered with another status passed")
	}
	if err := c.ValidateResponse(get, "", nil, http.StatusNotFound, problemHeader, []byte(`{"type":"x","title":"Not Found","status":404}`)); err == nil {
		t.Error("a problem without a code passed")
	}
	// What no schema describes is a problem document: chi's own 404, or an http.Error.
	plain := http.Header{"Content-Type": []string{"text/plain; charset=utf-8"}}
	if err := c.ValidateResponse(get, "", nil, http.StatusNotFound, plain, []byte("404 page not found\n")); err == nil {
		t.Error("a 404 to a request no route matched passed as plain text")
	}
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusInternalServerError, plain, []byte("boom\n")); err == nil {
		t.Error("a protocol-level 500 passed as plain text")
	}
	if err := c.ValidateResponse(get, "", nil, http.StatusNotFound, problemHeader, []byte(`{"type":"x","title":"Not Found","status":404,"code":"gone_fishing"}`)); err == nil {
		t.Error("a problem with a code outside ProblemCode passed")
	}
	if err := c.ValidateResponse(get, "", nil, http.StatusUnprocessableEntity, problemHeader,
		[]byte(`{"type":"x","title":"Unprocessable Entity","status":422,"code":"validation_failed"}`)); err == nil {
		t.Error("a validation problem without errors passed")
	}
}
