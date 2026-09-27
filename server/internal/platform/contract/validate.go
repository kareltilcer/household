package contract

import (
	"errors"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// Limits bound what the edge reads of a JSON request body. How long the body may take to
// arrive is httpx.BodyDeadline's, which bounds every request's body, read here or not.
type Limits struct {
	// MaxBody caps its size in bytes: a larger body is answered 413.
	MaxBody int64
}

// Middleware validates each request that router routes against the operation of the
// route it matched, before the handler runs, and answers a request that fails with its
// problem document: 422 validation_failed naming each offending field, 413 for a JSON body
// over limits.MaxBody bytes, 415 for a body in a media type the operation does not declare.
//
// It finds the route with Find, the lookup chi itself routes with, so a request is always
// validated against the operation whose handler will serve it; a request no route matches
// passes through untouched for chi to answer 404 or 405. Install it on the router that
// holds the contract's paths, the one mounted at BasePath. A request it refuses is recorded
// under its route, as chi records one it serves, so the access log names the operation.
//
// Authentication is not checked here: security requirements are the auth middleware's
// (items 8 and 9), and the validator is handed each operation without them (see
// validatingOperation). Defaults are not written into the request either, so a handler reads
// the body the client sent; a PATCH that filled in defaults would overwrite fields the
// client never mentioned. A readOnly member the client sends back, as a GET-modify-PUT
// round trip does, is validated against its schema and otherwise left for the handler to
// ignore: JSON Schema allows either ignoring or refusing it, and kin-openapi's refusal names
// no field.
//
// A JSON body is read here under the deadline httpx.BodyDeadline set, and a client that
// does not send it in time is disconnected; once the body is in, the deadline is cleared,
// since the handler's own work is not the body's to bound. A body in a media type other
// than JSON, a multipart upload for instance, is not read here: its handler streams it, and
// applies its own cap and deadline.
func (c *Contract) Middleware(router chi.Routes, limits Limits) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			m, found := Find(router, r.Method, httpx.RoutePath(r))
			if !found {
				next.ServeHTTP(w, r)
				return
			}
			// The route is recorded for as long as the edge answers for it: chi records the
			// route of a request it routes, and a refused request is never routed.
			rctx := chi.RouteContext(r.Context())
			if rctx != nil {
				rctx.RoutePatterns = append(rctx.RoutePatterns, m.Route)
			}
			op, ok := c.Lookup(r.Method, m.Path)
			if !ok {
				// A route the contract does not declare. The router refuses to build with
				// one (and architecture test 6 fails on it), so this is unreachable.
				problem.Write(w, reqctx.RequestID(r.Context()), problem.Internal())
				return
			}
			if p := c.validate(w, r, op, m.Params, limits); p != nil {
				problem.Write(w, reqctx.RequestID(r.Context()), p)
				return
			}
			if rctx != nil {
				rctx.RoutePatterns = rctx.RoutePatterns[:len(rctx.RoutePatterns)-1]
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (c *Contract) validate(w http.ResponseWriter, r *http.Request, o *Operation, params map[string]string, limits Limits) *problem.Problem {
	if fields := malformedQuery(r.URL.RawQuery); len(fields) > 0 {
		return problem.Validation(fields...)
	}
	options := &openapi3filter.Options{
		MultiError:                 true,
		SkipSettingDefaults:        true,
		ExcludeReadOnlyValidations: true,
	}
	clearDeadline := func() {}
	body := o.op.RequestBody
	if body == nil || body.Value == nil {
		// A body where the operation declares none, framed by a Content-Length or chunked.
		// kin-openapi's own refusal (RejectWhenRequestBodyNotSpecified) sees only a
		// Content-Length, and would hand a chunked body to a handler that never reads it.
		if r.ContentLength != 0 {
			return problem.Validation(problem.FieldError{Field: "", Code: problem.FieldInvalid})
		}
	} else {
		mediaType, declared, present := requestMediaType(r, body.Value)
		switch {
		case present && !declared:
			return problem.New(http.StatusUnsupportedMediaType, problem.CodeUnsupportedMediaType)
		case !present && r.ContentLength != 0:
			// A body with no Content-Type cannot be matched to a declared media type.
			return problem.New(http.StatusUnsupportedMediaType, problem.CodeUnsupportedMediaType)
		case present && !isJSON(mediaType):
			options.ExcludeRequestBody = true
		default:
			r.Body = http.MaxBytesReader(w, r.Body, limits.MaxBody)
			// The validator reads the body to its end, and net/http then reads the connection
			// to notice the client leaving: the body's deadline (httpx.BodyDeadline) reaching
			// that read would cancel the request's context mid-handler, so a body that
			// validates takes its deadline with it. A writer that cannot set a deadline, a
			// test's recorder, never had one.
			if r.ContentLength != 0 {
				clearDeadline = func() { _ = http.NewResponseController(w).SetReadDeadline(time.Time{}) }
			}
		}
	}

	err := openapi3filter.ValidateRequest(r.Context(), &openapi3filter.RequestValidationInput{
		Request:    r,
		PathParams: params,
		Route:      c.route(o),
		Options:    options,
	})
	if err == nil {
		clearDeadline()
		return nil
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		// The body did not arrive within its deadline. A client that slow is not reading a
		// response either: net/http closes the connection without one.
		panic(http.ErrAbortHandler)
	}
	// A refused request keeps the deadline: the unread rest of its body, which net/http
	// drains before answering, stays bounded by it.
	return toProblem(err)
}

// malformedQuery names each pair of the query string that net/url cannot parse: one with a
// bad escape, or with a ';', which Go no longer takes for a separator. net/url drops such a
// pair without a word, so neither kin-openapi nor the handler would see it, and a cursor
// dropped that way would be answered with page one, as if none had been sent (PRD 01 §6).
func malformedQuery(raw string) []problem.FieldError {
	var out []problem.FieldError
	for pair := range strings.SplitSeq(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		name, keyErr := url.QueryUnescape(key)
		_, valueErr := url.QueryUnescape(value)
		if keyErr == nil && valueErr == nil && !strings.Contains(pair, ";") {
			continue
		}
		if keyErr != nil {
			name = key
		}
		out = append(out, problem.FieldError{Field: "query:" + name, Code: problem.FieldMalformed})
	}
	return out
}

// requestMediaType returns the media type the request declares, whether the operation
// declares it too, and whether the request has a Content-Type at all.
//
// Media types are case-insensitive (RFC 9110 §8.3.1) and may have whitespace around the
// ';' before a parameter (§5.6.6), but kin-openapi looks the header up as it is written, so
// a declared one written any other way is handed on in canonical form:
// `Application/JSON ; charset=UTF-8` as `application/json; charset=UTF-8`.
func requestMediaType(r *http.Request, body *openapi3.RequestBody) (mediaType string, declared, present bool) {
	header := r.Header.Get("Content-Type")
	if header == "" {
		return "", false, false
	}
	mediaType, params, err := mime.ParseMediaType(header)
	if err != nil {
		return "", false, true
	}
	if body.Content.Get(mediaType) == nil {
		return mediaType, false, true
	}
	if canonical := mime.FormatMediaType(mediaType, params); canonical != "" && canonical != header {
		r.Header.Set("Content-Type", canonical)
	}
	return mediaType, true, true
}

func isJSON(mediaType string) bool {
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}

// toProblem turns a kin-openapi validation error into the problem the client receives.
func toProblem(err error) *problem.Problem {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return problem.New(http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)
	}
	var fields []problem.FieldError
	for _, e := range flatten(err) {
		fields = append(fields, fieldErrors(e)...)
	}
	if len(fields) == 0 {
		fields = []problem.FieldError{{Field: "", Code: problem.FieldInvalid}}
	}
	return problem.Validation(dedupe(fields)...)
}

// flatten returns the individual errors inside kin-openapi's MultiError nesting. It
// splits only a MultiError it is handed directly: errors.As would reach through a
// RequestError into the MultiError of its causes, and lose the parameter they belong to.
func flatten(err error) []error {
	multi, ok := err.(openapi3.MultiError) //nolint:errorlint // See above: the chain must not be searched.
	if !ok {
		return []error{err}
	}
	var out []error
	for _, e := range multi {
		out = append(out, flatten(e)...)
	}
	return out
}

// fieldErrors describes one request error: where, and which check failed.
func fieldErrors(err error) []problem.FieldError {
	var re *openapi3filter.RequestError
	if !errors.As(err, &re) {
		return []problem.FieldError{{Field: "", Code: problem.FieldInvalid}}
	}
	base := ""
	if re.Parameter != nil {
		base = re.Parameter.In + ":" + re.Parameter.Name
	}
	if re.Err == nil {
		// A refusal with no cause, such as kin-openapi's for a body in an undeclared media
		// type, which the edge answers 415 before asking it.
		return []problem.FieldError{{Field: base, Code: problem.FieldInvalid}}
	}

	var out []problem.FieldError
	for _, cause := range flatten(re.Err) {
		var schemaErr *openapi3.SchemaError
		var parseErr *openapi3filter.ParseError
		switch {
		case errors.As(cause, &schemaErr):
			for _, f := range schemaFieldErrors(schemaErr) {
				if re.Parameter != nil {
					f.Field = base
				}
				out = append(out, f)
			}
		case errors.As(cause, &parseErr), errors.Is(cause, openapi3filter.ErrInvalidEmptyValue):
			// kin-openapi reports apart an empty value for a parameter whose type cannot be
			// empty, `?limit=`: it does not parse either, and the schema has no length to name.
			out = append(out, problem.FieldError{Field: base, Code: problem.FieldMalformed})
		case errors.Is(cause, openapi3filter.ErrInvalidRequired):
			out = append(out, problem.FieldError{Field: base, Code: "required"})
		default:
			out = append(out, problem.FieldError{Field: base, Code: problem.FieldInvalid})
		}
	}
	return out
}

// schemaFieldErrors describes one schema failure at its JSON Pointer. An allOf failure is
// described by what failed inside it, since allOf is how the contract composes a Create
// from its Update plus a required list, and "all_of" at the root would name neither the
// field nor the check. Each failure inside already carries its whole path: kin-openapi
// marks them with every key it marks the allOf's own error with, so prefixing the allOf's
// path again would name /items/1/items/1/x for /items/1/x. A oneOf or anyOf failure stays
// as it is: which branch the client meant is not knowable, so listing every branch's
// complaint would mislead.
func schemaFieldErrors(err *openapi3.SchemaError) []problem.FieldError {
	if err.SchemaField == "allOf" {
		var out []problem.FieldError
		for _, inner := range schemaErrors(err.Origin) {
			out = append(out, schemaFieldErrors(inner)...)
		}
		if len(out) > 0 {
			return out
		}
	}
	return []problem.FieldError{{Field: pointer(err.JSONPointer()), Code: keyword(err.SchemaField)}}
}

// schemaErrors returns every SchemaError inside err, through the MultiErrors and the
// wrapping kin-openapi puts around the causes of an allOf. errors.As would stop at the
// first one.
func schemaErrors(err error) []*openapi3.SchemaError {
	//nolint:errorlint // A type switch on purpose: each layer is unwrapped here, one at a time.
	switch e := err.(type) {
	case nil:
		return nil
	case *openapi3.SchemaError:
		return []*openapi3.SchemaError{e}
	case openapi3.MultiError:
		var out []*openapi3.SchemaError
		for _, inner := range e {
			out = append(out, schemaErrors(inner)...)
		}
		return out
	case interface{ Unwrap() []error }:
		var out []*openapi3.SchemaError
		for _, inner := range e.Unwrap() {
			out = append(out, schemaErrors(inner)...)
		}
		return out
	case interface{ Unwrap() error }:
		return schemaErrors(e.Unwrap())
	}
	return nil
}

// pointerEscape escapes a JSON Pointer reference token (RFC 6901 §3).
var pointerEscape = strings.NewReplacer("~", "~0", "/", "~1")

// pointer renders a path of object keys and array indexes as an RFC 6901 JSON Pointer.
func pointer(path []string) string {
	var b strings.Builder
	for _, token := range path {
		b.WriteByte('/')
		b.WriteString(pointerEscape.Replace(token))
	}
	return b.String()
}

// keyword turns a JSON Schema keyword into the snake_case code a FieldError carries:
// maxLength becomes max_length.
func keyword(k string) string {
	switch k {
	case "":
		return problem.FieldInvalid
	case "nullable":
		// The built-in validator refuses a null under its OpenAPI 3.0 name. In the
		// contract's 3.1 vocabulary there is no nullable: a null the type does not admit
		// fails type.
		return "type"
	}
	var b strings.Builder
	for i, r := range k {
		if unicode.IsUpper(r) {
			if i > 0 {
				b.WriteByte('_')
			}
			r = unicode.ToLower(r)
		}
		b.WriteRune(r)
	}
	return b.String()
}

func dedupe(fields []problem.FieldError) []problem.FieldError {
	seen := make(map[problem.FieldError]bool, len(fields))
	out := fields[:0]
	for _, f := range fields {
		if !seen[f] {
			seen[f] = true
			out = append(out, f)
		}
	}
	return out
}
