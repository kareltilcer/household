// Package cursor mints and reads the opaque keyset cursors of paginated listings (PRD 01
// §6: "opaque cursor + limit, keyset on a natural ordering key").
//
// A cursor names the last row of a page by the values of its ORDER BY, so the next page
// resumes exactly after it however many rows were inserted in between. The token is
// base64url, unpadded, over the Keyset's name and those values joined by the ASCII unit
// separator, which no timestamp, UUID or lexorank position contains. The name binds a
// cursor to the ordering that minted it: handed to another listing, it is malformed rather
// than decoded into the wrong columns.
//
// **A malformed cursor is 422, never a silent page one.** A client whose cursor is quietly
// dropped receives page one again, reads it as the end of the list, and stops. FromRequest
// is therefore the only way a handler reads the parameter, and the edge validator refuses a
// query pair net/url cannot parse (`cursor=a;b`), which it would otherwise drop before
// FromRequest could see it.
//
// Cursors are not signed. A client that forges one moves its own keyset position within a
// query that is already scoped to what it may see, which it could do by paging anyway.
package cursor

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// Param is the query parameter that carries a cursor (the contract's Cursor and
// DateCursor parameters).
const Param = "cursor"

// sep joins a token's parts.
const sep = "\x1f"

// ErrMalformed is a token this package did not mint for the keyset reading it.
var ErrMalformed = errors.New("cursor: malformed")

// Keyset is one listing's ORDER BY: a name that is stable for as long as cursors minted
// under it may be in clients' hands, and the number of values in each cursor.
type Keyset struct {
	name  string
	arity int
}

// NewKeyset returns the keyset name ordering by arity values. It panics on an empty name,
// a name containing the separator, or an arity below one: each is a programming error.
func NewKeyset(name string, arity int) Keyset {
	if name == "" || strings.Contains(name, sep) || arity < 1 {
		panic("cursor: invalid keyset " + name)
	}
	return Keyset{name: name, arity: arity}
}

// Encode returns the cursor for a row whose ORDER BY values are values. It panics when
// their number is not the keyset's arity or one contains the separator: a cursor that
// would not decode is a bug, not a request error.
func (k Keyset) Encode(values ...string) string {
	if len(values) != k.arity {
		panic("cursor: " + k.name + " encodes a different number of values")
	}
	for _, v := range values {
		if strings.Contains(v, sep) {
			panic("cursor: a value of " + k.name + " contains the separator")
		}
	}
	return base64.RawURLEncoding.EncodeToString([]byte(k.name + sep + strings.Join(values, sep)))
}

// Decode returns the values of token, or ErrMalformed when token was not minted by
// Encode on this keyset.
func (k Keyset) Decode(token string) ([]string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, ErrMalformed
	}
	parts := strings.Split(string(raw), sep)
	if len(parts) != k.arity+1 || parts[0] != k.name {
		return nil, ErrMalformed
	}
	return parts[1:], nil
}

// FromRequest returns the values of the request's cursor, or nil for the first page when
// it has none. A cursor that is present and malformed, empty or repeated is a 422 naming
// the parameter.
func (k Keyset) FromRequest(r *http.Request) ([]string, error) {
	tokens, present := r.URL.Query()[Param]
	if !present {
		return nil, nil
	}
	if len(tokens) != 1 {
		return nil, Malformed()
	}
	values, err := k.Decode(tokens[0])
	if err != nil {
		return nil, Malformed()
	}
	return values, nil
}

// Malformed is the 422 for a cursor that does not decode, or whose values do not parse
// as the columns they are for.
func Malformed() *problem.Problem {
	return problem.Validation(problem.FieldError{Field: "query:" + Param, Code: problem.FieldMalformed})
}
