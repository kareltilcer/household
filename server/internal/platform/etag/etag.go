// Package etag carries an entity's version over HTTP (PRD 01 §6, the contract's ETag and
// If-Match): a representation answers with its version as an entity-tag, and a write that
// could overwrite someone else's change sends it back in If-Match, where a mismatch is 409
// with the current representation (problem.Conflict).
package etag

import (
	"net/http"
	"strconv"
	"strings"
)

// Format is version as the entity-tag the contract describes: the decimal version in double
// quotes, `"42"`.
func Format(version int64) string {
	return `"` + strconv.FormatInt(version, 10) + `"`
}

// Set sets w's ETag to version.
func Set(w http.ResponseWriter, version int64) {
	w.Header().Set("ETag", Format(version))
}

// Precondition is what a request's If-Match asks of the version it writes over.
type Precondition struct {
	present bool
	// anyVersion is `If-Match: *`, which any current version matches.
	anyVersion bool
	version    int64
}

// unmatchable is the version a tag that can match no version asks for: versions start at 1.
const unmatchable = 0

// IfMatch returns r's If-Match precondition. An absent header asks nothing, and the write is
// unconditional, as the contract says. A tag matches only the version it spells, compared
// strongly as RFC 9110 requires of If-Match: a weak tag, a tag that is not a version this server
// could have issued, `"042"` or `"x"`, and more than one If-Match header match none, so the
// write is refused as a conflict rather than applied. `*` matches whatever version the entity
// has, as RFC 9110 defines it: the write asks only that the entity exist.
func IfMatch(r *http.Request) Precondition {
	values := r.Header.Values("If-Match")
	if len(values) == 0 {
		return Precondition{}
	}
	p := Precondition{present: true, version: unmatchable}
	if len(values) > 1 {
		return p
	}
	tag := strings.TrimSpace(values[0])
	if tag == "*" {
		p.anyVersion = true
		return p
	}
	digits, ok := strings.CutPrefix(tag, `"`)
	if !ok {
		return p
	}
	digits, ok = strings.CutSuffix(digits, `"`)
	if !ok {
		return p
	}
	v, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || v < 1 || Format(v) != tag {
		return p
	}
	p.version = v
	return p
}

// Present reports whether the request sent If-Match.
func (p Precondition) Present() bool { return p.present }

// Allows reports whether a write over version current may proceed: always when the request sent
// no If-Match or `*`, and otherwise only when its tag is current's.
func (p Precondition) Allows(current int64) bool {
	return !p.present || p.anyVersion || p.version == current
}

// Expected is the version the write expects, and nil when it expects none: the request sent no
// If-Match, or `*`. A query takes it as `($n::bigint IS NULL OR version = $n)`, since a bare
// `version = $n` matches no row when it is nil. A tag that can match no version expects 0, which
// no row has.
func (p Precondition) Expected() *int64 {
	if !p.present || p.anyVersion {
		return nil
	}
	v := p.version
	return &v
}
