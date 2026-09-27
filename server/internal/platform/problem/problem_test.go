package problem_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	apispec "github.com/kareltilcer/household/docs/api"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/problem/internal/codegen"
)

// CI does not run `go generate`, so this is what fails when openapi.yaml gains, loses or
// renames a ProblemCode and codes_gen.go was not regenerated.
func TestCodesAreGeneratedFromTheCommittedContract(t *testing.T) {
	want, err := codegen.Render(apispec.OpenAPI)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, err := os.ReadFile(codegen.FileName)
	if err != nil {
		t.Fatalf("read %s: %v", codegen.FileName, err)
	}
	if string(got) != string(want) {
		t.Fatalf("%s is stale against docs/api/openapi.yaml; run `pnpm run gen`", codegen.FileName)
	}
}

func TestRenderRefusesAnEnumItCannotNameInGo(t *testing.T) {
	for name, spec := range map[string]string{
		"missing":    minimal(""),
		"camelCase":  minimal("[notFound]"),
		"duplicated": minimal("[not_found, not_found]"),
		"non-string": minimal("[404]"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := codegen.Render([]byte(spec)); err == nil {
				t.Fatal("Render succeeded")
			}
		})
	}
}

func minimal(enum string) string {
	s := "openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths: {}\ncomponents:\n  schemas:\n"
	if enum == "" {
		return s + "    Other: {type: string}\n"
	}
	return s + "    ProblemCode: {type: string, enum: " + enum + "}\n"
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return doc
}

func TestWriteProducesAnRFC9457Document(t *testing.T) {
	rec := httptest.NewRecorder()
	problem.Write(rec, "req-1", problem.NotFound())

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != problem.ContentType {
		t.Fatalf("Content-Type %q, want %q", ct, problem.ContentType)
	}
	doc := decode(t, rec)
	want := map[string]any{
		"type":       "urn:household:problem:not_found",
		"title":      "Not Found",
		"status":     float64(404),
		"code":       "not_found",
		"request_id": "req-1",
	}
	if len(doc) != len(want) {
		t.Fatalf("members %v, want exactly %v", doc, want)
	}
	for k, v := range want {
		if doc[k] != v {
			t.Errorf("%s = %#v, want %#v", k, doc[k], v)
		}
	}
}

func TestAValidationProblemAlwaysListsItsErrors(t *testing.T) {
	rec := httptest.NewRecorder()
	problem.Write(rec, "", problem.Validation())
	doc := decode(t, rec)
	errs, ok := doc["errors"].([]any)
	if !ok || len(errs) != 0 {
		t.Fatalf("errors = %#v, want an empty array (ValidationProblem requires it)", doc["errors"])
	}
	if _, ok := doc["request_id"]; ok {
		t.Error("request_id written without a request id")
	}

	rec = httptest.NewRecorder()
	problem.Write(rec, "", problem.Validation(problem.FieldError{Field: "/name", Code: "required"}))
	errs, _ = decode(t, rec)["errors"].([]any)
	if len(errs) != 1 {
		t.Fatalf("errors = %#v, want one", errs)
	}
}

func TestExtensionsCannotReplaceStandardMembers(t *testing.T) {
	p := problem.New(http.StatusConflict, problem.CodeVersionConflict)
	p.Extensions = map[string]any{
		"current_version": 7,
		"code":            "something_else",
		"status":          200,
		"detail":          "an untranslated sentence",
		"errors":          []string{"x"},
		"request_id":      "forged",
	}
	rec := httptest.NewRecorder()
	problem.Write(rec, "", p)
	doc := decode(t, rec)
	if doc["code"] != "version_conflict" || doc["status"] != float64(409) || doc["current_version"] != float64(7) {
		t.Fatalf("document %v", doc)
	}
	for _, k := range []string{"detail", "errors", "request_id"} {
		if _, ok := doc[k]; ok {
			t.Errorf("extension %q reached the document", k)
		}
	}
}

// A version conflict carries the entity as it is now and its version, in the body and as the
// ETag (the contract's VersionConflict), and its own headers cannot replace the document's.
func TestAConflictCarriesTheCurrentRepresentation(t *testing.T) {
	p := problem.Conflict(map[string]any{"title": "Oat milk"}, 12)
	p.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	problem.Write(rec, "", p)
	doc := decode(t, rec)
	current, _ := doc["current"].(map[string]any)
	if rec.Code != http.StatusConflict || doc["code"] != "version_conflict" || doc["current_version"] != float64(12) || current["title"] != "Oat milk" {
		t.Fatalf("%d %v", rec.Code, doc)
	}
	if got := rec.Header().Get("ETag"); got != `"12"` {
		t.Errorf("ETag %q, want \"12\"", got)
	}
	if got := rec.Header().Get("Content-Type"); got != problem.ContentType {
		t.Errorf("Content-Type %q", got)
	}
}

func TestAnErrorThatIsNotAProblemIsInternal(t *testing.T) {
	for _, err := range []error{errors.New("pq: secret detail"), nil} {
		rec := httptest.NewRecorder()
		problem.Write(rec, "", err)
		doc := decode(t, rec)
		if rec.Code != http.StatusInternalServerError || doc["code"] != "internal" {
			t.Fatalf("%v: %d %v", err, rec.Code, doc)
		}
		if len(doc) != 4 {
			t.Fatalf("%v: members %v; the cause must not reach the caller", err, doc)
		}
	}
}

func TestAWrappedProblemIsWrittenAsItself(t *testing.T) {
	rec := httptest.NewRecorder()
	problem.Write(rec, "", errors.Join(errors.New("context"), problem.New(http.StatusForbidden, problem.CodeForbidden)))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", rec.Code)
	}
}

func TestAnExtensionThatCannotBeEncodedDegradesToInternal(t *testing.T) {
	p := problem.New(http.StatusConflict, problem.CodeVersionConflict)
	p.Extensions = map[string]any{"current": make(chan int)}
	rec := httptest.NewRecorder()
	problem.Write(rec, "", p)
	if rec.Code != http.StatusInternalServerError || decode(t, rec)["code"] != "internal" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

func TestIdentifier(t *testing.T) {
	for code, want := range map[string]string{
		"not_found":             "CodeNotFound",
		"entitlement_read_only": "CodeEntitlementReadOnly",
		"internal":              "CodeInternal",
	} {
		if got := codegen.Identifier(code); got != want {
			t.Errorf("Identifier(%q) = %q, want %q", code, got, want)
		}
	}
}
