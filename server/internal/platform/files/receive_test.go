package files

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// fullDisk fails every write, as the upload directory's disk does once it is full.
type fullDisk struct{}

func (fullDisk) Write([]byte) (int, error) { return 0, errors.New("no space left on device") }

// A part that cannot be written is the server's failure, not the body's: it is no problem the
// client is answered with. A part that stops arriving is refused as malformed, and one over the
// limit 413.
func TestAPartIsRefusedOnlyForWhatTheClientSent(t *testing.T) {
	var p *problem.Problem
	if _, err := copyPart(fullDisk{}, strings.NewReader("a photograph"), 100); err == nil || errors.As(err, &p) {
		t.Fatalf("a spool that cannot be written: %v", err)
	}
	if _, err := copyPart(io.Discard, iotest.ErrReader(errors.New("connection reset")), 100); !errors.As(err, &p) ||
		p.Status != http.StatusUnprocessableEntity || p.Code != problem.CodeValidationFailed {
		t.Fatalf("a part that stopped arriving: %v", err)
	}
	if _, err := copyPart(io.Discard, strings.NewReader("four"), 3); !errors.As(err, &p) || p.Status != http.StatusRequestEntityTooLarge {
		t.Fatalf("a part over the limit: %v", err)
	}
	if n, err := copyPart(io.Discard, strings.NewReader("four"), 4); err != nil || n != 4 {
		t.Fatalf("a part at the limit: %d, %v", n, err)
	}
}
