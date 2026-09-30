package imaging

import "golang.org/x/sync/semaphore"

// SetBudget makes n the budget the images decoded at once hold between them, for a test that fills
// one small enough to fill with a few small images, and returns what puts Budget back. A test that
// calls it runs alone: the budget is the process's.
func SetBudget(n int64) (restore func()) {
	oldBudget, oldDecoding := budget, decoding
	budget, decoding = n, semaphore.NewWeighted(n)
	return func() { budget, decoding = oldBudget, oldDecoding }
}

// Footprint is footprint, for the test that sizes its budget by it.
var Footprint = footprint
