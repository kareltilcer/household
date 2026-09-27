// Package contract holds docs/api/openapi.yaml as the server reads it: the operations it
// declares, the edge validation of every request against them (PRD 07 §4, "every request
// body validated against the OpenAPI schema at the edge"), and the validation of responses
// that the tests run.
//
// Paths here are the contract's own, relative to the /api/v1 server URL:
// "/households/{household_id}/notes". The server mounts its API router at /api/v1 and
// registers routes under exactly these templates, so a chi route pattern and a contract
// path are the same string (architecture test 6 keeps it so).
package contract

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/routers"

	apispec "github.com/kareltilcer/household/docs/api"
)

// BasePath is where the contract's paths are served: the path of its server URLs.
const BasePath = "/api/v1"

// Contract is a parsed OpenAPI document and an index of its operations.
type Contract struct {
	doc *openapi3.T
	// validating is doc as kin-openapi's validator is given it; see newValidatingView.
	validating *openapi3.T
	byRoute    map[string]*Operation
	byID       map[string]*Operation
	operations []*Operation
}

// Operation is one method on one path.
type Operation struct {
	ID     string
	Method string
	Path   string

	item *openapi3.PathItem
	op   *openapi3.Operation
	// validating is op as kin-openapi's validators are given it; see validatingOperation.
	validating *openapi3.Operation
}

// load parses the committed contract once per process.
var load = sync.OnceValues(func() (*Contract, error) { return Parse(apispec.OpenAPI) })

// Load returns the committed contract, docs/api/openapi.yaml.
func Load() (*Contract, error) { return load() }

// Parse reads an OpenAPI document and checks that the validator can use it: it resolves
// every reference, it is valid OpenAPI, and every operation has a unique operationId.
func Parse(spec []byte) (*Contract, error) {
	loader := openapi3.NewLoader()
	doc, err := loader.LoadFromData(spec)
	if err != nil {
		return nil, fmt.Errorf("contract: load: %w", err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		return nil, fmt.Errorf("contract: validate: %w", err)
	}

	c := &Contract{
		doc:        doc,
		validating: newValidatingView(doc),
		byRoute:    map[string]*Operation{},
		byID:       map[string]*Operation{},
	}
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			o := &Operation{ID: op.OperationID, Method: method, Path: path, item: item, op: op, validating: validatingOperation(op)}
			if o.ID == "" {
				return nil, fmt.Errorf("contract: %s %s has no operationId", method, path)
			}
			if other, dup := c.byID[o.ID]; dup {
				return nil, fmt.Errorf("contract: operationId %s names both %s %s and %s %s", o.ID, other.Method, other.Path, method, path)
			}
			c.byID[o.ID] = o
			c.byRoute[routeKey(method, path)] = o
			c.operations = append(c.operations, o)
		}
	}
	slices.SortFunc(c.operations, func(a, b *Operation) int {
		if n := strings.Compare(a.Path, b.Path); n != 0 {
			return n
		}
		return strings.Compare(a.Method, b.Method)
	})
	return c, nil
}

func routeKey(method, path string) string { return method + " " + path }

// Lookup returns the operation for method on path, a contract path template.
func (c *Contract) Lookup(method, path string) (*Operation, bool) {
	o, ok := c.byRoute[routeKey(method, path)]
	return o, ok
}

// Operations returns every operation, ordered by path and then method.
func (c *Contract) Operations() []*Operation { return slices.Clone(c.operations) }

// ByID returns the operation with the given operationId.
func (c *Contract) ByID(id string) (*Operation, bool) {
	o, ok := c.byID[id]
	return o, ok
}

// newValidatingView returns doc as the request validator is to see it: the same document,
// reporting itself as OpenAPI 3.0.
//
// For a 3.1 document kin-openapi validates every value with a JSON Schema 2020-12 validator
// that it compiles from the schema on each call, per request. That path reports a failure
// as one sentence with no location in it, so no ValidationProblem could name the field;
// and it cannot resolve a component $ref from a lone schema, so on most of this contract's
// bodies it falls back to the built-in validator anyway. The built-in validator implements
// every 3.1 keyword the contract uses (type arrays with "null", const, a numeric
// exclusiveMinimum, oneOf with type 'null' branches), which contract_test.go pins, and
// reports each failure with its JSON Pointer and keyword. docs/adr/0003 records the choice.
func newValidatingView(doc *openapi3.T) *openapi3.T {
	view := *doc // A shallow copy: both share every path, operation and schema.
	view.OpenAPI = "3.0.3"
	return &view
}

// validatingOperation returns op as the validators are to see it: the same operation, with
// no security requirement.
//
// Authentication is the auth middleware's (items 8 and 9), not the validator's, and
// kin-openapi's check of a requirement reads the whole request body into memory before
// anything else, whatever its media type and whether or not the operation declares one.
// Under the contract's global requirement that is every operation but the two probes: a
// multipart upload would be buffered before its handler could stream it, and a body on an
// operation that takes none read to its end, both past the edge's cap and deadline.
func validatingOperation(op *openapi3.Operation) *openapi3.Operation {
	view := *op // A shallow copy: both share every parameter, body and response.
	view.Security = &openapi3.SecurityRequirements{}
	return &view
}

// route is o as kin-openapi's validators take it.
func (c *Contract) route(o *Operation) *routers.Route {
	return &routers.Route{Spec: c.validating, Path: o.Path, PathItem: o.item, Method: o.Method, Operation: o.validating}
}
