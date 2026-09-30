package contract

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"mime"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/mail"
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
// does not send it in time is disconnected; once the body is in, net/http clears the
// deadline, and the handler's own work is not the body's to bound. A body in a media type
// other than JSON, a multipart upload for instance, is not read here: its handler streams
// it, and applies its own cap and deadline.
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
				// one (and architecture test 6 fails on it), and Find reports no mount
				// point, which chi's lookup matches without a route, so this is unreachable.
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
	if fields := unreadableParameters(r, o, params); len(fields) > 0 {
		return problem.Validation(dedupe(fields)...)
	}
	options := &openapi3filter.Options{
		MultiError:                 true,
		SkipSettingDefaults:        true,
		ExcludeReadOnlyValidations: true,
	}
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
			// The validator reads the body to its end, under the deadline httpx.BodyDeadline
			// set. There net/http clears the deadline itself, as it starts the read that
			// notices the client leaving, so the handler's own work is not bounded by it.
			r.Body = http.MaxBytesReader(w, r.Body, limits.MaxBody)
		}
	}

	err := openapi3filter.ValidateRequest(r.Context(), &openapi3filter.RequestValidationInput{
		Request:    r,
		PathParams: params,
		Route:      c.route(o),
		Options:    options,
	})
	if err == nil {
		return nil
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		// The body did not arrive within its deadline. A client that slow is not reading a
		// response either: net/http closes the connection without one.
		panic(http.ErrAbortHandler)
	}
	// A refused request whose body is not all in keeps the deadline: the rest, which net/http
	// drains before answering, stays bounded by it.
	return toProblem(err)
}

// unreadableParameters names each parameter the edge refuses as malformed before kin-openapi
// reads any: a query pair net/url cannot parse, and a query, path or header value that is not
// text PostgreSQL stores as sent. A value that decodes to U+0000 or to bytes that are not
// UTF-8 (`%00`, `%FF`) is refused in a parameter as strictJSON refuses it in a body: a text
// column refuses it, so the handler's query would fail as a 500. A header has no escapes, but
// may carry bytes that are not UTF-8; only the headers the operation declares are read.
func unreadableParameters(r *http.Request, o *Operation, params map[string]string) []problem.FieldError {
	out := malformedQuery(r.URL.RawQuery)
	for _, name := range slices.Sorted(maps.Keys(params)) {
		if !storable(params[name]) {
			out = append(out, problem.FieldError{Field: "path:" + name, Code: problem.FieldMalformed})
		}
	}
	for _, declared := range []openapi3.Parameters{o.item.Parameters, o.op.Parameters} {
		for _, ref := range declared {
			p := ref.Value
			if p == nil || p.In != openapi3.ParameterInHeader {
				continue
			}
			for _, value := range r.Header.Values(p.Name) {
				if !storable(value) {
					out = append(out, problem.FieldError{Field: "header:" + p.Name, Code: problem.FieldMalformed})
					break
				}
			}
		}
	}
	return out
}

// malformedQuery names each pair of the query string that net/url cannot parse, or that
// decodes to text PostgreSQL does not store as sent. net/url drops a pair with a bad escape,
// or with a ';', which Go no longer takes for a separator, without a word, so neither
// kin-openapi nor the handler would see it, and a cursor dropped that way would be answered
// with page one, as if none had been sent (PRD 01 §6).
func malformedQuery(raw string) []problem.FieldError {
	var out []problem.FieldError
	for pair := range strings.SplitSeq(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		name, keyErr := url.QueryUnescape(key)
		decoded, valueErr := url.QueryUnescape(value)
		if keyErr == nil && valueErr == nil && !strings.Contains(pair, ";") && storable(name) && storable(decoded) {
			continue
		}
		if keyErr != nil || !storable(name) {
			name = key
		}
		out = append(out, problem.FieldError{Field: "query:" + name, Code: problem.FieldMalformed})
	}
	return out
}

// storable reports whether s is text PostgreSQL stores as sent: UTF-8, without U+0000.
func storable(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
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

// init has kin-openapi decode application/json, the only JSON media type the contract
// declares a body in, with strictJSON instead of its own decoder. A contract that declares
// another registers it here too.
//
// It also has kin-openapi hold `date` and `date-time` to the calendar and the clock. Its own
// check is a regular expression, which takes 2026-02-31 for a date and +99:99 for an offset:
// PostgreSQL refuses both, so the handler's write would fail as a 500. The expression still
// holds a value to RFC 3339's grammar, which Go's parser reads more loosely (it takes a comma
// before a fraction of a second), and the parser then holds it to the calendar. Go's parser
// takes no leap second, so neither does the edge: 23:59:60 is refused.
//
// And it has kin-openapi hold `email` to an address, which it does not check at all by default:
// mail.ValidAddress, a bare address at a domain name, no longer than SMTP carries, the one check
// the server makes of an address wherever it takes one.
func init() {
	openapi3filter.RegisterBodyDecoder("application/json", strictJSON)
	openapi3.DefineStringFormatValidator("date", onTheCalendar(openapi3.FormatOfStringDate, time.DateOnly))
	openapi3.DefineStringFormatValidator("date-time", onTheCalendar(openapi3.FormatOfStringDateTime, time.RFC3339))
	openapi3.DefineStringFormatValidator("email", openapi3.NewCallbackValidator(func(value string) error {
		if !mail.ValidAddress(value) {
			return errors.New("not an email address")
		}
		return nil
	}))
}

// onTheCalendar validates a value that pattern matches and that time.Parse reads with layout.
func onTheCalendar(pattern, layout string) openapi3.StringFormatValidator {
	grammar := regexp.MustCompile(pattern)
	return openapi3.NewCallbackValidator(func(value string) error {
		if !grammar.MatchString(value) {
			return errors.New("not RFC 3339")
		}
		_, err := time.Parse(layout, value)
		return err
	})
}

// strictJSON decodes a JSON body as kin-openapi's own decoder does, and first refuses one
// that is not a JSON text (RFC 8259) whose every string is text PostgreSQL can store. That
// decoder reads only the first value, so a body with anything after it (`{…} x`, `{…}{…}`)
// would be validated by its first value and handed on whole. Go's decoder reads bytes that
// are not UTF-8, and a \u escape of half a surrogate pair (`"\ud800"`), as U+FFFD, so the
// handler would store a character the client never sent; and it reads `\u0000` as the NUL
// character, which a text or jsonb column refuses, so the handler's write would fail as a
// 500. The refusal is a ParseError, which the edge answers 422 malformed.
func strictJSON(body io.Reader, header http.Header, schema *openapi3.SchemaRef, encoding openapi3filter.EncodingFn) (any, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, &openapi3filter.ParseError{Kind: openapi3filter.KindInvalidFormat, Cause: err}
	}
	if !json.Valid(data) || !utf8.Valid(data) || !storableEscapes(data) {
		return nil, &openapi3filter.ParseError{Kind: openapi3filter.KindInvalidFormat, Reason: "not a JSON text"}
	}
	return openapi3filter.JSONBodyDecoder(bytes.NewReader(data), header, schema, encoding)
}

// storableEscapes reports whether every \u escape in data, a valid JSON text, names a
// character PostgreSQL stores as sent: neither U+0000 nor half of a surrogate pair. JSON
// escapes a character outside the Basic Multilingual Plane as a pair, a high half and then
// a low one.
func storableEscapes(data []byte) bool {
	// A JSON text has a backslash only inside a string, where it starts an escape: a
	// character, or u and four hex digits.
	unit := func(i int) (rune, bool) {
		if i+6 > len(data) || data[i] != '\\' || data[i+1] != 'u' {
			return 0, false
		}
		n, err := strconv.ParseUint(string(data[i+2:i+6]), 16, 16)
		return rune(n), err == nil
	}
	for i := 0; i < len(data); i++ {
		if data[i] != '\\' {
			continue
		}
		r, ok := unit(i)
		if !ok {
			i++ // A one-character escape, `\"` or `\\` among them: skip what it escapes.
			continue
		}
		i += 5
		switch {
		case r == 0:
			return false
		case utf16.IsSurrogate(r):
			low, ok := unit(i + 1)
			if !ok || utf16.DecodeRune(r, low) == unicode.ReplacementChar {
				return false
			}
			i += 6
		}
	}
	return true
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
	return []problem.FieldError{{Field: problem.Pointer(err.JSONPointer()...), Code: keyword(err.SchemaField)}}
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
