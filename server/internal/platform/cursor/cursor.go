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
	"bytes"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

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
// Encode on this keyset. A token whose values are not text PostgreSQL stores as sent,
// holding U+0000 or bytes that are not UTF-8, is forged, since the values of a row never
// are: handed to the listing's query, it would fail it as a 500.
func (k Keyset) Decode(token string) ([]string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
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

// The page of a listing: the contract's Limit, 50 unless the request says, 200 at most.
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// Limit is the page size r asks for; the edge has held it to the contract's Limit. It is never more
// than MaxLimit, whatever the request says, so that nothing sized by it is sized by the client.
func Limit(r *http.Request) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n < 1 {
		return DefaultLimit
	}
	if n > MaxLimit {
		return MaxLimit
	}
	return n
}

// PageMeta is the contract's PageMeta: the cursor the next page resumes from, null on the last
// page, and whether there is a next page.
type PageMeta struct {
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
}

// Before returns where r's request resumes a listing ordered newest first, by an instant and then
// by an id, a keyset of two values: the instant and the id of the last row of the page before, and
// a nil instant for the first page, as a query's `$1::timestamptz IS NULL OR (at, id) < ($1, $2)`
// takes them. A cursor whose values are not an instant and an id is malformed, the 422. It panics on
// a keyset of another number of values, a programming error, as Encode does.
func (k Keyset) Before(r *http.Request) (*time.Time, uuid.UUID, error) {
	if k.arity != 2 {
		panic("cursor: " + k.name + " is no keyset of an instant and an id")
	}
	values, err := k.FromRequest(r)
	if err != nil || values == nil {
		return nil, uuid.Nil, err
	}
	at, errAt := time.Parse(time.RFC3339Nano, values[0])
	id, errID := uuid.Parse(values[1])
	if errAt != nil || errID != nil {
		return nil, uuid.Nil, Malformed()
	}
	return &at, id, nil
}

// After is the PageMeta of a page of such a listing that more rows follow: its cursor names the
// page's last row, made at at with id.
func (k Keyset) After(at time.Time, id uuid.UUID) PageMeta {
	next := k.Encode(at.UTC().Format(time.RFC3339Nano), id.String())
	return PageMeta{NextCursor: &next, HasMore: true}
}
