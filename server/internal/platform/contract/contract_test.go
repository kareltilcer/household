package contract_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

const (
	household = "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a90"
	other     = "0190f3a2-4c1b-7c3e-9a5f-2b6d8e4f1a91"
	maxBody   = 1 << 10
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
	api.Use(c.Middleware(api, maxBody))
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
	rec := call{method: http.MethodPost, path: lists, contentType: "application/json; charset=utf-8", body: body}.do(t, h)
	if rec.Code != http.StatusNoContent || string(seen.body) != body {
		t.Fatalf("status %d, handler saw %q", rec.Code, seen.body)
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

func TestMalformedAndMissingBodies(t *testing.T) {
	h, _ := router(t)
	for name, tc := range map[string]struct {
		c    call
		want problem.FieldError
	}{
		"not JSON":  {call{method: http.MethodPost, path: lists, contentType: "application/json", body: `{"name":`}, problem.FieldError{Field: "", Code: "malformed"}},
		"no body":   {call{method: http.MethodPost, path: lists, contentType: "application/json"}, problem.FieldError{Field: "", Code: "required"}},
		"no header": {call{method: http.MethodPost, path: lists}, problem.FieldError{Field: "", Code: "required"}},
	} {
		t.Run(name, func(t *testing.T) {
			sameErrors(t, fieldErrors(t, tc.c.do(t, h)), tc.want)
		})
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

// An upload is streamed by its handler, which applies its own cap; the JSON cap and the
// JSON validator stay out of its way.
func TestAMultipartUploadIsLeftToItsHandler(t *testing.T) {
	h, seen := router(t)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "photo.jpg")
	_, _ = part.Write(bytes.Repeat([]byte{0xff}, 4*maxBody))
	_ = form.Close()
	rec := call{
		method: http.MethodPost, path: "/households/" + household + "/notes/" + other + "/images",
		contentType: form.FormDataContentType(), body: body.String(),
	}.do(t, h)
	if rec.Code != http.StatusNoContent || len(seen.body) != body.Len() {
		t.Fatalf("status %d, handler saw %d of %d bytes", rec.Code, len(seen.body), body.Len())
	}
}

func TestParametersAreValidated(t *testing.T) {
	h, _ := router(t)
	harvests := "/households/" + household + "/garden/harvests"
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?limit=500"}.do(t, h)),
		problem.FieldError{Field: "query:limit", Code: "maximum"})
	sameErrors(t, fieldErrors(t, call{method: http.MethodGet, path: harvests + "?season_year=soon"}.do(t, h)),
		problem.FieldError{Field: "query:season_year", Code: "malformed"})
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

	if rec := (call{method: http.MethodGet, path: harvests + "?limit=200&season_year=2026"}).do(t, h); rec.Code != http.StatusNoContent {
		t.Fatalf("valid parameters: %d %s", rec.Code, rec.Body.String())
	}
}

func TestABodyOnAnOperationThatTakesNoneIs422(t *testing.T) {
	h, seen := router(t)
	rec := call{method: http.MethodGet, path: "/households/" + household + "/garden/harvests", contentType: "application/json", body: `{}`}.do(t, h)
	sameErrors(t, fieldErrors(t, rec), problem.FieldError{Field: "", Code: "invalid"})
	if seen.called {
		t.Fatal("the handler ran")
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
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusTeapot, jsonHeader, []byte(`{}`)); err == nil {
		t.Error("an undeclared status passed")
	}
	internal := []byte(`{"type":"urn:household:problem:internal","title":"Internal Server Error","status":500,"code":"internal"}`)
	if err := c.ValidateResponse(get, "/healthz", nil, http.StatusInternalServerError, problemHeader, internal); err != nil {
		t.Errorf("a protocol-level 500: %v", err)
	}
	if err := c.ValidateResponse(get, "", nil, http.StatusNotFound, problemHeader, []byte(`{"type":"x","title":"Not Found","status":404}`)); err == nil {
		t.Error("a problem without a code passed")
	}
	if err := c.ValidateResponse(get, "", nil, http.StatusNotFound, problemHeader, []byte(`{"type":"x","title":"Not Found","status":404,"code":"gone_fishing"}`)); err == nil {
		t.Error("a problem with a code outside ProblemCode passed")
	}
	if err := c.ValidateResponse(get, "", nil, http.StatusUnprocessableEntity, problemHeader,
		[]byte(`{"type":"x","title":"Unprocessable Entity","status":422,"code":"validation_failed"}`)); err == nil {
		t.Error("a validation problem without errors passed")
	}
}
