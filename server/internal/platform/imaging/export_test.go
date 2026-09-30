package imaging

import (
	"image"
	"io"

	"golang.org/x/sync/semaphore"
)

// SetBudget makes n the budget the images decoded at once hold between them, for a test that fills
// one small enough to fill with a few small images, and returns what puts Budget back. A test that
// calls it runs alone: the budget is the process's.
func SetBudget(n int64) (restore func()) {
	oldBudget, oldDecoding := budget, decoding
	budget, decoding = n, semaphore.NewWeighted(n)
	return func() { budget, decoding = oldBudget, oldDecoding }
}

// SetDecoder makes decode what decodes contentType, whose header is still read by the real decoder,
// for a test that needs a decoder to fail as no real one does on the bytes it is given, and returns
// what puts the real one back. A test that calls it runs alone: the decoders are the process's.
func SetDecoder(contentType string, decode func(io.Reader) (image.Image, error)) (restore func()) {
	old := decoders[contentType]
	replaced := old
	replaced.decode = decode
	decoders[contentType] = replaced
	return func() { decoders[contentType] = old }
}

// Footprint is footprint, for the test that sizes its budget by it.
var Footprint = footprint
