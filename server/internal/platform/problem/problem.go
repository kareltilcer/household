// Package problem writes RFC 9457 problem documents, the body of every error response
// (PRD 01 §6). Clients switch on Code, which is the contract's ProblemCode enum generated
// into Go (codes_gen.go), so a code the contract does not declare cannot be compiled in and
// a code the contract drops breaks the build.
//
// A Problem carries no human-readable detail. The contract calls `detail` translated, and
// the server renders no translated strings yet (PRD 03 §9 renders server-side strings from
// keys against the recipient's language), so an English sentence here would be the one
// user-visible literal the product forbids. `title` is the HTTP reason phrase, which RFC
// 9457 §3.1.4 asks to stay the same from occurrence to occurrence.
package problem

//go:generate go run ./internal/gen

import (
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"strconv"

	"github.com/kareltilcer/household/server/internal/platform/etag"
)

// ContentType is the media type of every problem document.
const ContentType = "application/problem+json"

// TypePrefix starts every problem's `type`, which ends in its code. It is a URN rather
// than a URL because no page documents the codes yet and a URL that does not resolve reads
// as a broken link; clients switch on `code`, never on `type`, so a later move to URLs
// changes nothing they rely on.
const TypePrefix = "urn:household:problem:"

// FieldError names one offending part of a request in a ValidationProblem.
//
// Field says where. For the request body it is an RFC 6901 JSON Pointer ("/name",
// "/items/0/amount_minor", "" for the body as a whole). For a parameter it is its location
// and its name as the contract declares it: "query:limit", "header:If-Match",
// "path:household_id". A pointer is empty or starts with "/", so the two cannot collide.
//
// Code says what, in snake_case: the JSON Schema keyword that failed ("required", "type",
// "max_length", "pattern", "enum", …) or one of the codes this package names below.
type FieldError struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// Field error codes that are not JSON Schema keywords.
const (
	// FieldMalformed is a value that does not parse: a body that is not JSON, a query
	// value that is not the declared type or is empty, a cursor this server did not mint.
	FieldMalformed = "malformed"
	// FieldInvalid is a refusal no keyword names: a body on an operation that takes none,
	// or a failure the validator did not describe.
	FieldInvalid = "invalid"
)

// Problem is an RFC 9457 problem document. It is also an error, so a handler returns one
// and a single place writes it.
type Problem struct {
	Status int
	Code   Code
	// Errors is the ValidationProblem member, and is written only when Code is
	// CodeValidationFailed.
	Errors []FieldError
	// Extensions are further top-level members, such as ConflictProblem's `current` and
	// `current_version`. A key that names a member this package writes is ignored.
	Extensions map[string]any
	// Header holds response headers the problem answers with, such as a conflict's ETag. The
	// headers this package writes itself are not taken from it.
	Header http.Header
}

// reserved are the members this package writes, which an extension may not replace.
var reserved = []string{"type", "title", "status", "code", "detail", "instance", "request_id", "errors"}

// New returns a problem with the given status and code.
func New(status int, code Code) *Problem {
	return &Problem{Status: status, Code: code}
}

// Validation returns the 422 validation_failed problem listing errs.
func Validation(errs ...FieldError) *Problem {
	return &Problem{Status: http.StatusUnprocessableEntity, Code: CodeValidationFailed, Errors: errs}
}

// NotFound is the 404 for anything absent or not visible to the caller; the two are
// deliberately indistinguishable (the contract's NotFound response).
func NotFound() *Problem { return New(http.StatusNotFound, CodeNotFound) }

// Internal is the 500 for a failure the caller cannot act on. What went wrong is logged
// on the server; the response says only that it did.
func Internal() *Problem { return New(http.StatusInternalServerError, CodeInternal) }

// Conflict is the 409 version_conflict for a write whose If-Match named a version the entity
// no longer has (the contract's VersionConflict): it carries current, the entity's
// representation now, and its version, as current_version and as the ETag, so that the client
// can merge or re-present the member's change without reading the entity again.
func Conflict(current any, version int64) *Problem {
	return &Problem{
		Status:     http.StatusConflict,
		Code:       CodeVersionConflict,
		Extensions: map[string]any{"current": current, "current_version": version},
		Header:     http.Header{"Etag": {etag.Format(version)}},
	}
}

// Error reports the status and code, for logs and test failures.
func (p *Problem) Error() string {
	return "problem " + strconv.Itoa(p.Status) + " " + string(p.Code)
}

// Write writes err as a problem document. An error that is not a *Problem, and nil, are
// written as Internal: the cause stays on the server, where the caller logs it.
func Write(w http.ResponseWriter, requestID string, err error) {
	var p *Problem
	if !errors.As(err, &p) {
		p = Internal()
	}
	body, mErr := json.Marshal(p.document(requestID))
	if mErr != nil {
		// Only an Extensions value can fail to marshal. The response is still a problem.
		p = Internal()
		body, _ = json.Marshal(p.document(requestID))
	}
	h := w.Header()
	for key, values := range p.Header {
		h[http.CanonicalHeaderKey(key)] = values
	}
	h.Set("Content-Type", ContentType)
	h.Set("Content-Length", strconv.Itoa(len(body)))
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(p.Status)
	_, _ = w.Write(body)
}

// document is p as the JSON members of its problem document.
func (p *Problem) document(requestID string) map[string]any {
	doc := make(map[string]any, len(p.Extensions)+6)
	maps.Copy(doc, p.Extensions)
	for _, key := range reserved {
		delete(doc, key)
	}
	doc["type"] = TypePrefix + string(p.Code)
	doc["title"] = http.StatusText(p.Status)
	doc["status"] = p.Status
	doc["code"] = p.Code
	if requestID != "" {
		doc["request_id"] = requestID
	}
	if p.Code == CodeValidationFailed {
		errs := p.Errors
		if errs == nil {
			errs = []FieldError{}
		}
		doc["errors"] = errs
	}
	return doc
}
