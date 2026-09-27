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

	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// ProtocolStatuses are the statuses an operation may answer with although it does not
// declare them: 405 and 500 (the contract's two protocol-level ProblemCodes), and the three
// the edge validator answers before a handler runs, 413, 415 and 422. The contract admits
// 413 and 415 only from an operation that takes a body (see protocolStatus).
var ProtocolStatuses = []int{
	http.StatusMethodNotAllowed,
	http.StatusRequestEntityTooLarge,
	http.StatusUnsupportedMediaType,
	http.StatusUnprocessableEntity,
	http.StatusInternalServerError,
}

// protocolStatus reports whether o may answer status without declaring it.
func protocolStatus(o *Operation, status int) bool {
	switch status {
	case http.StatusRequestEntityTooLarge, http.StatusUnsupportedMediaType:
		return o.op.RequestBody != nil
	}
	return slices.Contains(ProtocolStatuses, status)
}

// ValidateResponse checks a response against the contract. pattern is the route the
// request matched, in the contract's path form, or "" when none did; params are that
// route's path parameters.
//
// A matched route's response must have a status its operation declares, or one of
// ProtocolStatuses the operation may answer undeclared, and a body its declared schema
// accepts. A problem document, whatever the status and whether or not a route matched,
// must be a valid Problem, and a validation_failed one a valid ValidationProblem. What no
// schema describes must be a problem document: the answer to a request no route matched,
// and a status the operation answers undeclared.
func (c *Contract) ValidateResponse(req *http.Request, pattern string, params map[string]string, status int, header http.Header, body []byte) error {
	problemDocument := isProblem(header)
	if problemDocument {
		if err := c.validateProblem(body); err != nil {
			return err
		}
	}
	if pattern == "" {
		if !problemDocument {
			return fmt.Errorf("%s answered %d to a request no route matched, and not with a problem document", req.Method, status)
		}
		return nil
	}
	o, ok := c.Lookup(req.Method, pattern)
	if !ok {
		return fmt.Errorf("%s %s is not in the contract", req.Method, pattern)
	}
	if o.op.Responses.Status(status) == nil && o.op.Responses.Default() == nil {
		switch {
		case !protocolStatus(o, status):
			return fmt.Errorf("%s %s answered %d, which operation %s does not declare", req.Method, pattern, status, o.ID)
		case !problemDocument:
			return fmt.Errorf("%s %s answered %d, which operation %s does not declare, and not with a problem document", req.Method, pattern, status, o.ID)
		}
		return nil
	}
	err := openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    req,
			PathParams: params,
			Route:      c.route(o),
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
