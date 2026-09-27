// Package auth carries the authenticated caller through a request's context. Items 8 and 9
// authenticate a request, by its session cookie or its access token, and put the caller here;
// what reads it, the tenant middleware first, never authenticates anything itself. A request
// that reaches a reader with no caller here is unauthenticated.
package auth

import (
	"context"

	"github.com/google/uuid"
)

type userKey struct{}

// WithUser returns ctx carrying id as the authenticated caller.
func WithUser(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, userKey{}, id)
}

// User returns the authenticated caller ctx carries, and false when it carries none.
func User(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userKey{}).(uuid.UUID)
	return id, ok && id != uuid.Nil
}
