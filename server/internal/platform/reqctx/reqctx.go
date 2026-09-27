// Package reqctx carries the identifiers of one request through its context: the request
// id, minted as the request arrives, and the household id, known only once the tenant
// middleware has resolved it (item 3). The logger reads both from here, so every line a
// request logs carries them without each call site passing them along (FR-NF5).
package reqctx

import (
	"context"
	"sync"
)

type scopeKey struct{}

// Scope holds one request's identifiers. The household id is set after the scope is
// created, by middleware further in, and the request's access-log line is written by
// middleware further out; both hold the same *Scope, which is why it is a pointer with a
// setter rather than a value in the context.
type Scope struct {
	requestID string

	mu          sync.Mutex
	householdID string
}

// New returns ctx carrying a new scope for requestID, and the scope.
func New(ctx context.Context, requestID string) (context.Context, *Scope) {
	s := &Scope{requestID: requestID}
	return context.WithValue(ctx, scopeKey{}, s), s
}

// From returns the scope ctx carries, or nil outside a request.
func From(ctx context.Context) *Scope {
	s, _ := ctx.Value(scopeKey{}).(*Scope)
	return s
}

// RequestID returns the id of the request ctx belongs to, or "" outside a request.
func RequestID(ctx context.Context) string {
	if s := From(ctx); s != nil {
		return s.requestID
	}
	return ""
}

// RequestID returns the scope's request id.
func (s *Scope) RequestID() string { return s.requestID }

// SetHouseholdID records the household the request addresses, once it has been resolved.
func (s *Scope) SetHouseholdID(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.householdID = id
}

// HouseholdID returns the household the request addresses, or "" when it has none or it
// has not been resolved yet.
func (s *Scope) HouseholdID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.householdID
}
