package contract

import (
	"errors"
	"mime"
	"net/http"
	"slices"
	"strings"
	"unicode"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// Middleware validates each request that router routes against the operation of the
// route it matched, before the handler runs, and answers a request that fails with its
// problem document: 422 validation_failed naming each offending field, 413 for a JSON body
// over maxBody bytes, 415 for a body in a media type the operation does not declare.
//
// It finds the route with router.Find, the lookup chi itself routes with, so a request is
// always validated against the operation whose handler will serve it; a request no route
// matches passes through untouched for chi to answer 404 or 405. Install it on the router
// that holds the contract's paths, the one mounted at BasePath.
//
// Authentication is not checked here: security requirements are the auth middleware's
// (items 8 and 9). Defaults are not written into the request either, so a handler reads
// the body the client sent; a PATCH that filled in defaults would overwrite fields the
// client never mentioned.
//
// A body in a media type other than JSON, a multipart upload for instance, is not read
// here: its handler streams it, and applies its own cap.
func (c *Contract) Middleware(router chi.Routes, maxBody int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rctx := chi.NewRouteContext()
			pattern := router.Find(rctx, r.Method, httpx.RoutePath(r))
			if pattern == "" {
				next.ServeHTTP(w, r)
				return
			}
			op, ok := c.Lookup(r.Method, pattern)
			if !ok {
				// A route the contract does not declare. The router refuses to build with
				// one (and architecture test 6 fails on it), so this is unreachable.
				problem.Write(w, reqctx.RequestID(r.Context()), problem.Internal())
				return
			}
			params := make(map[string]string, len(rctx.URLParams.Keys))
			for i, key := range rctx.URLParams.Keys {
				params[key] = rctx.URLParams.Values[i]
			}
			if p := c.validate(w, r, op, params, maxBody); p != nil {
				problem.Write(w, reqctx.RequestID(r.Context()), p)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (c *Contract) validate(w http.ResponseWriter, r *http.Request, o *Operation, params map[string]string, maxBody int64) *problem.Problem {
	options := &openapi3filter.Options{
		MultiError:          true,
		AuthenticationFunc:  openapi3filter.NoopAuthenticationFunc,
		SkipSettingDefaults: true,
	}
	body := o.op.RequestBody
	if body == nil || body.Value == nil {
		// A body where the operation declares none. kin-openapi applies this option to
		// every request with a Content-Length, declared body or not, so it is set only here.
		options.RejectWhenRequestBodyNotSpecified = true
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
			r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		}
	}

	err := openapi3filter.ValidateRequest(r.Context(), &openapi3filter.RequestValidationInput{
		Request:    r,
		PathParams: params,
		Route: &routers.Route{
			Spec:      c.validating,
			Path:      o.Path,
			PathItem:  o.item,
			Method:    o.Method,
			Operation: o.op,
		},
		Options: options,
	})
	if err == nil {
		return nil
	}
	return toProblem(err)
}

// requestMediaType returns the media type the request declares, whether the operation
// declares it too, and whether the request has a Content-Type at all.
func requestMediaType(r *http.Request, body *openapi3.RequestBody) (mediaType string, declared, present bool) {
	header := r.Header.Get("Content-Type")
	if header == "" {
		return "", false, false
	}
	mediaType, _, err := mime.ParseMediaType(header)
	if err != nil {
		return "", false, true
	}
	return mediaType, body.Content.Get(header) != nil, true
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
		// A refusal with no cause: a body in an undeclared media type, or a body on an
		// operation that takes none.
		return []problem.FieldError{{Field: base, Code: problem.FieldInvalid}}
	}

	var out []problem.FieldError
	for _, cause := range flatten(re.Err) {
		var schemaErr *openapi3.SchemaError
		var parseErr *openapi3filter.ParseError
		switch {
		case errors.As(cause, &schemaErr):
			for _, f := range schemaFieldErrors(schemaErr, nil) {
				if re.Parameter != nil {
					f.Field = base
				}
				out = append(out, f)
			}
		case errors.As(cause, &parseErr):
			out = append(out, problem.FieldError{Field: base, Code: problem.FieldMalformed})
		case errors.Is(cause, openapi3filter.ErrInvalidRequired):
			out = append(out, problem.FieldError{Field: base, Code: "required"})
		case errors.Is(cause, openapi3filter.ErrInvalidEmptyValue):
			out = append(out, problem.FieldError{Field: base, Code: "min_length"})
		default:
			out = append(out, problem.FieldError{Field: base, Code: problem.FieldInvalid})
		}
	}
	return out
}

// schemaFieldErrors describes one schema failure at its JSON Pointer below prefix. An
// allOf failure is described by what failed inside it, since allOf is how the contract
// composes a Create from its Update plus a required list, and "all_of" at the root would
// name neither the field nor the check. A oneOf or anyOf failure stays as it is: which
// branch the client meant is not knowable, so listing every branch's complaint would
// mislead.
func schemaFieldErrors(err *openapi3.SchemaError, prefix []string) []problem.FieldError {
	path := append(slices.Clone(prefix), err.JSONPointer()...)
	if err.SchemaField == "allOf" {
		var out []problem.FieldError
		for _, inner := range schemaErrors(err.Origin) {
			out = append(out, schemaFieldErrors(inner, path)...)
		}
		if len(out) > 0 {
			return out
		}
	}
	return []problem.FieldError{{Field: pointer(path), Code: keyword(err.SchemaField)}}
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

// pointer renders a path of object keys and array indexes as an RFC 6901 JSON Pointer.
func pointer(path []string) string {
	var b strings.Builder
	for _, token := range path {
		b.WriteByte('/')
		b.WriteString(strings.NewReplacer("~", "~0", "/", "~1").Replace(token))
	}
	return b.String()
}

// keyword turns a JSON Schema keyword into the snake_case code a FieldError carries:
// maxLength becomes max_length.
func keyword(k string) string {
	if k == "" {
		return problem.FieldInvalid
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
