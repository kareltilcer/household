package contract

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Route is a method and a path pattern a router serves.
type Route struct {
	Method string
	// Path is the pattern as chi reports it: the full path, BasePath included, with any
	// regular expression in a parameter left in place.
	Path string
}

// Routes lists every route router serves.
func Routes(router chi.Routes) ([]Route, error) {
	var routes []Route
	err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes = append(routes, Route{Method: method, Path: route})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("contract: walk the routes: %w", err)
	}
	return routes, nil
}

// Kind is what a Violation is.
type Kind int

// The disagreements architecture test 6 fails on (PRD 01 §10).
const (
	// OutsideBase is a route the server serves outside BasePath, where no contract path
	// can describe it.
	OutsideBase Kind = iota
	// Undeclared is a route the contract does not declare.
	Undeclared
	// ImplementedWhilePending is a route implemented while its operation is still on
	// contract_pending, which must shrink as operations are built.
	ImplementedWhilePending
	// StalePending is an entry on contract_pending that names no operation in the
	// contract, or names one twice.
	StalePending
	// Unimplemented is an operation that no route serves and contract_pending does not
	// list: a path in the contract with no route.
	Unimplemented
)

// Violation is one disagreement between the routes, the contract and contract_pending.
type Violation struct {
	Kind        Kind
	Method      string
	Path        string
	OperationID string
}

func (v Violation) String() string {
	switch v.Kind {
	case OutsideBase:
		return fmt.Sprintf("%s %s is served outside %s, where the contract cannot declare it", v.Method, v.Path, BasePath)
	case Undeclared:
		return fmt.Sprintf("%s %s is served but not declared in openapi.yaml", v.Method, v.Path)
	case ImplementedWhilePending:
		return fmt.Sprintf("%s (%s %s) is implemented; remove it from contract_pending", v.OperationID, v.Method, v.Path)
	case StalePending:
		return fmt.Sprintf("contract_pending lists %s, which openapi.yaml does not declare or which it lists twice", v.OperationID)
	case Unimplemented:
		return fmt.Sprintf("%s (%s %s) is neither served nor listed on contract_pending", v.OperationID, v.Method, v.Path)
	}
	return fmt.Sprintf("violation %d", v.Kind)
}

// parameterPattern matches the regular expression chi allows inside a path parameter,
// {id:[0-9]+}, which the contract's template does not carry.
var parameterPattern = regexp.MustCompile(`\{([^{}:]+):[^{}]*\}`)

// contractPath is route's path as the contract would write it, and whether it is under
// BasePath at all.
func contractPath(route string) (string, bool) {
	path, ok := strings.CutPrefix(route, BasePath)
	if !ok || !strings.HasPrefix(path, "/") {
		return "", false
	}
	return template(path), true
}

// template is a chi pattern less the regular expressions in its parameters.
func template(pattern string) string { return parameterPattern.ReplaceAllString(pattern, "{$1}") }

// Match is the route a router serves a request with.
type Match struct {
	// Route is the pattern as chi reports it, relative to the router it was found on, with
	// any regular expression in a parameter left in place.
	Route string
	// Path is the contract path it serves, the form Lookup takes.
	Path string
	// Params are the route's path parameters.
	Params map[string]string
}

// Find returns the route router serves method on path with, found by the lookup chi itself
// routes with, or false when no route matches. path is what router routes by, which
// httpx.RoutePath returns: below the mount point for a router mounted at BasePath, the
// whole path, escaped as sent, for the root router that mounts it.
func Find(router chi.Routes, method, path string) (Match, bool) {
	rctx := chi.NewRouteContext()
	route := router.Find(rctx, method, path)
	if route == "" {
		return Match{}, false
	}
	params := make(map[string]string, len(rctx.URLParams.Keys))
	for i, key := range rctx.URLParams.Keys {
		if key != "*" { // The mount point's wildcard, which no contract path has.
			params[key] = rctx.URLParams.Values[i]
		}
	}
	path = route
	if below, ok := strings.CutPrefix(route, BasePath); ok && strings.HasPrefix(below, "/") {
		path = below
	}
	return Match{Route: route, Path: template(path), Params: params}, true
}

// Diff reports every disagreement between the routes a router serves, the contract, and
// pending, the operation ids of contract_pending. Violations are ordered by kind and then
// as the inputs list them.
func (c *Contract) Diff(routes []Route, pending []string) []Violation {
	var out []Violation
	pendingSet := map[string]bool{}
	for _, id := range pending {
		if _, ok := c.ByID(id); !ok || pendingSet[id] {
			out = append(out, Violation{Kind: StalePending, OperationID: id})
		}
		pendingSet[id] = true
	}

	served := map[string]bool{}
	for _, r := range routes {
		path, ok := contractPath(r.Path)
		if !ok {
			out = append(out, Violation{Kind: OutsideBase, Method: r.Method, Path: r.Path})
			continue
		}
		o, declared := c.Lookup(r.Method, path)
		switch {
		case !declared:
			out = append(out, Violation{Kind: Undeclared, Method: r.Method, Path: path})
		case pendingSet[o.ID]:
			out = append(out, Violation{Kind: ImplementedWhilePending, Method: o.Method, Path: o.Path, OperationID: o.ID})
			served[o.ID] = true
		default:
			served[o.ID] = true
		}
	}

	for _, o := range c.operations {
		if !served[o.ID] && !pendingSet[o.ID] {
			out = append(out, Violation{Kind: Unimplemented, Method: o.Method, Path: o.Path, OperationID: o.ID})
		}
	}
	slices.SortStableFunc(out, func(a, b Violation) int { return int(a.Kind) - int(b.Kind) })
	return out
}

// ReadPending reads a contract_pending list: one operationId per line, with blank lines
// and lines starting with # ignored.
func ReadPending(r io.Reader) ([]string, error) {
	var ids []string
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		ids = append(ids, line)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("contract: read contract_pending: %w", err)
	}
	return ids, nil
}
