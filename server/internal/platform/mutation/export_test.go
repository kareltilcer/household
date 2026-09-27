package mutation

import "context"

// WithBeforeCommit returns ctx carrying fn, which Apply calls once it has written a mutation's
// audit event and changes and before it commits them: the moment the household's feed lock is
// held and nothing is visible yet.
func WithBeforeCommit(ctx context.Context, fn func()) context.Context {
	return context.WithValue(ctx, hookKey{}, fn)
}
