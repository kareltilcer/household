package contract

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"slices"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"

	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// ProtocolStatuses are the statuses any operation may answer with although none declares
// them: 405 and 500 (the contract's two protocol-level ProblemCodes), and the three the
// edge validator answers before a handler runs, 413, 415 and 422.
var ProtocolStatuses = []int{
	http.StatusMethodNotAllowed,
	http.StatusRequestEntityTooLarge,
	http.StatusUnsupportedMediaType,
	http.StatusUnprocessableEntity,
	http.StatusInternalServerError,
}

// ValidateResponse checks a response against the contract. pattern is the route the
// request matched, in the contract's path form, or "" when none did; params are that
// route's path parameters.
//
// A matched route's response must have a status its operation declares, or one of
// ProtocolStatuses, and a body its declared schema accepts. A problem document, whatever
// the status and whether or not a route matched, must be a valid Problem, and a
// validation_failed one a valid ValidationProblem.
func (c *Contract) ValidateResponse(req *http.Request, pattern string, params map[string]string, status int, header http.Header, body []byte) error {
	if isProblem(header) {
		if err := c.validateProblem(body); err != nil {
			return err
		}
	}
	if pattern == "" {
		return nil
	}
	o, ok := c.Lookup(req.Method, pattern)
	if !ok {
		return fmt.Errorf("%s %s is not in the contract", req.Method, pattern)
	}
	if o.op.Responses.Status(status) == nil && o.op.Responses.Default() == nil {
		if slices.Contains(ProtocolStatuses, status) {
			return nil
		}
		return fmt.Errorf("%s %s answered %d, which operation %s does not declare", req.Method, pattern, status, o.ID)
	}
	err := openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    req,
			PathParams: params,
			Route: &routers.Route{
				Spec: c.validating, Path: o.Path, PathItem: o.item, Method: o.Method, Operation: o.op,
			},
		},
		Status:  status,
		Header:  header,
		Body:    io.NopCloser(bytes.NewReader(body)),
		Options: &openapi3filter.Options{MultiError: true, IncludeResponseStatus: true},
	})
	if err != nil {
		return fmt.Errorf("%s %s answered %d against operation %s: %w", req.Method, pattern, status, o.ID, err)
	}
	return nil
}

func isProblem(header http.Header) bool {
	mediaType, _, err := mime.ParseMediaType(header.Get("Content-Type"))
	return err == nil && mediaType == problem.ContentType
}

// validateProblem checks body against Problem, or ValidationProblem when its code is
// validation_failed.
func (c *Contract) validateProblem(body []byte) error {
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return fmt.Errorf("the problem document is not JSON: %w", err)
	}
	name := "Problem"
	if doc, ok := value.(map[string]any); ok && doc["code"] == string(problem.CodeValidationFailed) {
		name = "ValidationProblem"
	}
	ref := c.doc.Components.Schemas[name]
	if ref == nil || ref.Value == nil {
		return errors.New("the contract has no " + name + " schema")
	}
	if err := ref.Value.VisitJSON(value, openapi3.MultiErrors(), openapi3.VisitAsResponse()); err != nil {
		return fmt.Errorf("the problem document is not a valid %s: %w", name, err)
	}
	return nil
}
