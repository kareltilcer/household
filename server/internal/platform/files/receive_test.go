package files

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/iotest"
	"time"

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

// form is a multipart request carrying fields, each name and value in turn, and a file.
func form(t *testing.T, fields ...string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for i := 0; i+1 < len(fields); i += 2 {
		if err := w.WriteField(fields[i], fields[i+1]); err != nil {
			t.Fatal(err)
		}
	}
	part, err := w.CreateFormFile(FileField, "list.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(part, "Milk, eggs\n"); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/files", &body)
	r.Header.Set("Content-Type", w.FormDataContentType())
	return r
}

// A field sent twice is refused as a second file is, naming the field: which of its two values the
// module took is not left to guess. A field sent once is the module's to read.
func TestAFieldSentTwiceIsRefused(t *testing.T) {
	s := &Service{maxBytes: MaxBytes, timeout: time.Minute, dir: t.TempDir()}
	u, err := s.Receive(httptest.NewRecorder(), form(t, "id", "a", "private", "true"), Rules{})
	if err != nil {
		t.Fatal(err)
	}
	if u.Fields["id"] != "a" || u.Fields["private"] != "true" {
		t.Errorf("fields = %v", u.Fields)
	}
	if err := u.Close(); err != nil {
		t.Fatal(err)
	}

	_, err = s.Receive(httptest.NewRecorder(), form(t, "id", "a", "id", "b"), Rules{})
	var p *problem.Problem
	if !errors.As(err, &p) || p.Status != http.StatusUnprocessableEntity || len(p.Errors) != 1 ||
		p.Errors[0].Field != "/id" || p.Errors[0].Code != problem.FieldInvalid {
		t.Fatalf("a field sent twice: %v", err)
	}
	if entries, _ := os.ReadDir(s.dir); len(entries) != 0 {
		t.Fatalf("the refused upload left %v", entries)
	}

	// The client names the field, and the refusal names it back as one member, escaped as RFC 6901
	// escapes a pointer's token, rather than as a member nested in another.
	_, err = s.Receive(httptest.NewRecorder(), form(t, "a/b~c", "1", "a/b~c", "2"), Rules{})
	if !errors.As(err, &p) || len(p.Errors) != 1 || p.Errors[0].Field != "/a~1b~0c" {
		t.Fatalf("a field named with a slash and a tilde, sent twice: %v", err)
	}
}
