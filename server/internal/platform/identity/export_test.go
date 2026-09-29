package identity

import "context"

// Turns is turns, for the tests.
type Turns = turns

// Take is take.
func (t *turns) Take(ctx context.Context, key string) (func(), error) { return t.take(ctx, key) }

// Waiting is how many requests hold key's turn or wait for it, and false when the key is kept for
// none.
func (t *turns) Waiting(key string) (int, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	k, ok := t.keys[key]
	if !ok {
		return 0, false
	}
	return k.waiting, true
}
