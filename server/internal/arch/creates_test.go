package arch_test

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	apispec "github.com/kareltilcer/household/docs/api"
	"github.com/kareltilcer/household/server/internal/arch/testdata/entities"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Architecture test 9 (PRD 01 §10, D-23, D-91): every REST operation that creates a sync
// entity requires the client-generated id in its body. An entity that got a server id online
// and a client id offline is the dual identity D-23 exists to prevent, and the requirement is
// easy to meet on the sync path and to forget on the REST one. It reads the contract and the
// registry together: each operation an entity names among its Creates must be in the contract,
// be a POST or a PUT, take a body, and require, in every media type it takes, either id, a UUID,
// or ids, an array of them, for an operation that creates several.
func TestCreatesRequireTheClientsID(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromData(apispec.OpenAPI)
	if err != nil {
		t.Fatal(err)
	}
	var all []sync.Entity
	for _, m := range registry(t).All() {
		if source, ok := m.(module.SyncSource); ok {
			all = append(all, source.SyncEntities()...)
		}
	}
	for _, v := range createViolations(doc, all) {
		t.Error(v)
	}
}

// Test 9 against deliberate violations: testdata/entities/openapi.yaml declares the create
// operations of entities.Creating, some that break the rule and some that keep it, and
// creates.txt is every violation the test must report.
func TestCreatesRequireTheClientsIDCatchesEachViolation(t *testing.T) {
	dir := os.DirFS(filepath.Join("testdata", "entities"))
	spec, err := fs.ReadFile(dir, "openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := openapi3.NewLoader().LoadFromData(spec)
	if err != nil {
		t.Fatal(err)
	}
	got := createViolations(doc, entities.Creating())
	want := lines(t, dir, "creates.txt")
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// createViolations returns each create operation of es that doc does not declare to require the
// client's id.
func createViolations(doc *openapi3.T, es []sync.Entity) []string {
	type operation struct {
		method string
		op     *openapi3.Operation
	}
	byID := map[string]operation{}
	for _, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			byID[op.OperationID] = operation{method, op}
		}
	}
	var out []string
	for _, e := range es {
		for _, id := range e.Creates {
			bad := func(format string, args ...any) {
				out = append(out, fmt.Sprintf("%s: create operation %s ", e.Name, id)+fmt.Sprintf(format, args...))
			}
			o, ok := byID[id]
			switch {
			case !ok:
				bad("is not in the contract")
				continue
			case o.method != http.MethodPost && o.method != http.MethodPut:
				bad("is a %s, which creates nothing", o.method)
				continue
			case o.op.RequestBody == nil || o.op.RequestBody.Value == nil || len(o.op.RequestBody.Value.Content) == 0:
				bad("takes no body to carry the client's id")
				continue
			}
			content := o.op.RequestBody.Value.Content
			mediaTypes := make([]string, 0, len(content))
			for mt := range content {
				mediaTypes = append(mediaTypes, mt)
			}
			slices.Sort(mediaTypes)
			for _, mt := range mediaTypes {
				var schema *openapi3.Schema
				if ref := content[mt].Schema; ref != nil {
					schema = ref.Value
				}
				switch requiresID(schema) {
				case idMissing:
					bad("does not require the client's id in its %s body", mt)
				case idNotUUID:
					bad("requires id in its %s body, but not as a UUID", mt)
				case idRequired:
				}
			}
		}
	}
	return out
}

// idRequirement is how a body schema asks for the client's id.
type idRequirement int

const (
	idMissing idRequirement = iota
	idNotUUID
	idRequired
)

// requiresID reports how s requires the client's id: id, a string, or ids, an array of strings,
// among its required members or those of any schema it is allOf, or of every schema it is
// oneOf or anyOf, since a body need match only one of those.
func requiresID(s *openapi3.Schema) idRequirement {
	if s == nil {
		return idMissing
	}
	best := idMissing
	for _, name := range s.Required {
		var member *openapi3.Schema
		if ref := s.Properties[name]; ref != nil {
			member = ref.Value
		}
		switch name {
		case "id":
			best = max(best, idNotUUID)
			if isString(member) {
				return idRequired
			}
		case "ids":
			best = max(best, idNotUUID)
			if member != nil && member.Type.Is(openapi3.TypeArray) && member.Items != nil && isString(member.Items.Value) {
				return idRequired
			}
		}
	}
	for _, ref := range s.AllOf {
		if ref != nil {
			best = max(best, requiresID(ref.Value))
		}
	}
	for _, branches := range []openapi3.SchemaRefs{s.OneOf, s.AnyOf} {
		if len(branches) == 0 {
			continue
		}
		weakest := idRequired
		for _, ref := range branches {
			if ref == nil {
				weakest = idMissing
				continue
			}
			weakest = min(weakest, requiresID(ref.Value))
		}
		best = max(best, weakest)
	}
	return best
}

// isString reports whether s is a string schema, as the contract's Uuid is.
func isString(s *openapi3.Schema) bool {
	return s != nil && s.Type.Is(openapi3.TypeString)
}
