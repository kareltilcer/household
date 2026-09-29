// Package clientversion holds a client to the oldest version the server still serves (PRD 06 §7,
// FR-HA18). Each client names itself in the Household-Client header, its type and its version,
// `mobile/1.4.2`; a client below the minimum for its type is answered 400 update_required, the
// blocking, translated please-update screen, and nothing else, whatever it asked for. The check
// runs before the request is held to the contract, since a client too old to be served is the
// one most likely to send what the contract no longer admits.
//
// A request that names no client, a probe's or a script's, is not held to a minimum: the header is
// what a client of Household's own sends, and the minimum is a promise about those.
package clientversion

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// Header is the request header a client names itself in.
const Header = "Household-Client"

// Version is a client's version, MAJOR.MINOR.PATCH, compared by its numbers alone: a pre-release
// or build suffix is ignored, so a beta of a release counts as the release.
type Version struct {
	Major, Minor, Patch int
}

// String is v as MAJOR.MINOR.PATCH.
func (v Version) String() string { return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch) }

// Less reports whether v is older than w.
func (v Version) Less(w Version) bool {
	if v.Major != w.Major {
		return v.Major < w.Major
	}
	if v.Minor != w.Minor {
		return v.Minor < w.Minor
	}
	return v.Patch < w.Patch
}

// semver is MAJOR.MINOR.PATCH with an optional pre-release and build (SemVer 2.0.0), each number
// without a leading zero.
var semver = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?:-[0-9A-Za-z.-]{1,64})?(?:\+[0-9A-Za-z.-]{1,64})?$`)

// ParseVersion reads s as a version, and false when it is not one.
func ParseVersion(s string) (Version, bool) {
	m := semver.FindStringSubmatch(s)
	if m == nil {
		return Version{}, false
	}
	var v Version
	v.Major, _ = strconv.Atoi(m[1])
	v.Minor, _ = strconv.Atoi(m[2])
	v.Patch, _ = strconv.Atoi(m[3])
	return v, true
}

// The client types, as the contract's ClientType names them.
const (
	Web    = "web"
	Mobile = "mobile"
)

// Client is what a request's header says: its client's type and version, and the version as it
// was written.
type Client struct {
	Type    string
	Version Version
	Raw     string
}

var header = regexp.MustCompile(`^(web|mobile)/(.+)$`)

// Parse reads a Household-Client header's value, and false when it is not one.
func Parse(value string) (Client, bool) {
	m := header.FindStringSubmatch(value)
	if m == nil {
		return Client{}, false
	}
	v, ok := ParseVersion(m[2])
	if !ok {
		return Client{}, false
	}
	return Client{Type: m[1], Version: v, Raw: m[2]}, true
}

type clientKey struct{}

// From returns the client ctx's request named in its header, and false when it named none.
func From(ctx context.Context) (Client, bool) {
	c, ok := ctx.Value(clientKey{}).(Client)
	return c, ok
}

// Minimums are the oldest version of each client type the server serves; a type left out has none.
type Minimums map[string]Version

// Refusal is the 400 update_required problem, naming the oldest version served.
func Refusal(minimum Version) *problem.Problem {
	p := problem.New(http.StatusBadRequest, problem.CodeUpdateRequired)
	p.Extensions = map[string]any{"minimum_version": minimum.String()}
	return p
}

// Middleware answers a request whose client is older than its type's minimum with 400
// update_required, and one whose Household-Client header is not a client's with 422 naming the
// header. Any other request passes, carrying its client, when it named one, for the handlers.
func Middleware(minimums Minimums) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			values := r.Header.Values(Header)
			if len(values) == 0 {
				next.ServeHTTP(w, r)
				return
			}
			c, ok := Parse(values[0])
			if !ok || len(values) > 1 {
				problem.Write(w, reqctx.RequestID(r.Context()),
					problem.Validation(problem.FieldError{Field: "header:" + Header, Code: problem.FieldMalformed}))
				return
			}
			if minimum, set := minimums[c.Type]; set && c.Version.Less(minimum) {
				problem.Write(w, reqctx.RequestID(r.Context()), Refusal(minimum))
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientKey{}, c)))
		})
	}
}
