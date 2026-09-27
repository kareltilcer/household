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
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// Architecture test 9 (PRD 01 §10, D-23, D-91): every REST operation that creates a sync
// entity requires the client-generated id in its body. An entity that got a server id online
// and a client id offline is the dual identity D-23 exists to prevent, and the requirement is
// easy to meet on the sync path and to forget on the REST one. It reads the contract and the
// registry together: each operation an entity names among its Creates must be in the contract,
// be a POST or a PUT, require a body, since a create that may come without one may come without
// an id, and require in it, in every media type it takes, either id, a UUID, or ids, an array of
// them, for an operation that creates several.
func TestCreatesRequireTheClientsID(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromData(apispec.OpenAPI)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range createViolations(doc, registry(t).Entities()) {
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
			case !o.op.RequestBody.Value.Required:
				bad("does not require its body, so a create may come without the client's id")
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

// requiresID reports how s requires the client's id: id, a UUID, or ids, an array of UUIDs,
// among the members s requires. A schema requires what it and every schema it is allOf require,
// and each member is described by whichever of them describes it: the contract writes a create
// as allOf its update schema, which describes the members, and a schema that only lists the
// required ones (HarvestCreate). A oneOf or anyOf requires the id only if every branch does,
// read together with the schemas it is combined with, since a body need match only one branch.
func requiresID(s *openapi3.Schema) idRequirement {
	return requirement(s, members{})
}

// requirement is requiresID for s combined with outer, the members of the schemas s is a branch
// of.
func requirement(s *openapi3.Schema, outer members) idRequirement {
	if s == nil {
		return idMissing
	}
	m, groups := outer.with(s)
	best := m.requirement()
	for _, branches := range groups {
		weakest := idRequired
		for _, ref := range branches {
			var branch *openapi3.Schema
			if ref != nil {
				branch = ref.Value
			}
			weakest = min(weakest, requirement(branch, m))
		}
		best = max(best, weakest)
	}
	return best
}

// members are the members a schema requires, and the schemas that describe each member.
type members struct {
	required   []string
	properties map[string][]*openapi3.Schema
}

// with returns m together with what s and every schema it is allOf require and describe, and
// the oneOf and anyOf groups among them, each of which a body matches one branch of. m is left
// as it is, since each branch of a group is combined with it on its own.
func (m members) with(s *openapi3.Schema) (members, []openapi3.SchemaRefs) {
	out := members{required: slices.Clone(m.required), properties: make(map[string][]*openapi3.Schema, len(m.properties))}
	for name, described := range m.properties {
		out.properties[name] = slices.Clone(described)
	}
	var groups []openapi3.SchemaRefs
	var add func(*openapi3.Schema)
	add = func(s *openapi3.Schema) {
		if s == nil {
			return
		}
		out.required = append(out.required, s.Required...)
		for name, ref := range s.Properties {
			if ref != nil && ref.Value != nil {
				out.properties[name] = append(out.properties[name], ref.Value)
			}
		}
		for _, branches := range []openapi3.SchemaRefs{s.OneOf, s.AnyOf} {
			if len(branches) > 0 {
				groups = append(groups, branches)
			}
		}
		for _, ref := range s.AllOf {
			if ref != nil {
				add(ref.Value)
			}
		}
	}
	add(s)
	return out, groups
}

// requirement reports how m requires the client's id: id or ids among its required members,
// described as a UUID or an array of them by a schema that describes it.
func (m members) requirement() idRequirement {
	best := idMissing
	for _, name := range m.required {
		switch name {
		case "id":
			best = max(best, idNotUUID)
			if slices.ContainsFunc(m.properties[name], isUUID) {
				return idRequired
			}
		case "ids":
			best = max(best, idNotUUID)
			if slices.ContainsFunc(m.properties[name], isUUIDArray) {
				return idRequired
			}
		}
	}
	return best
}

// isUUID reports whether s is a UUID, a string of format uuid, as the contract's Uuid is. Any
// string would admit a name or a number where the client's id belongs, which the edge would pass
// and the uuid column refuse.
func isUUID(s *openapi3.Schema) bool {
	return s != nil && s.Type.Is(openapi3.TypeString) && s.Format == "uuid"
}

// isUUIDArray reports whether s is an array of UUIDs.
func isUUIDArray(s *openapi3.Schema) bool {
	return s != nil && s.Type.Is(openapi3.TypeArray) && s.Items != nil && isUUID(s.Items.Value)
}
