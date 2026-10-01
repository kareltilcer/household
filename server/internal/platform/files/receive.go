package files

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// Upload is a file a request carried, read to a temporary file and checked: its size, its digest,
// and its type, sniffed from its bytes. Its holder closes it, which removes the file.
type Upload struct {
	Type   Type
	Size   int64
	SHA256 [32]byte
	// Filename is the name the client gave the file, made safe to save under (cleanName), "" for
	// none. It names a download, never a type.
	Filename string
	// Fields are the form's other fields, by name.
	Fields map[string]string
	file   *os.File
}

// Reader reads the upload from its start.
func (u *Upload) Reader() *io.SectionReader { return io.NewSectionReader(u.file, 0, u.Size) }

// Close removes the upload's temporary file.
func (u *Upload) Close() error {
	if u == nil || u.file == nil {
		return nil
	}
	name := u.file.Name()
	err := u.file.Close()
	if rmErr := os.Remove(name); rmErr != nil && !errors.Is(rmErr, os.ErrNotExist) && err == nil {
		err = rmErr
	}
	u.file = nil
	return err
}

// Rules are what a route takes.
type Rules struct {
	// Accept takes the types the route stores; AnyType when nil. A program is refused whatever it
	// says.
	Accept Accept
	// MaxBytes caps the file below the pipeline's cap, zero for the pipeline's.
	MaxBytes int64
}

// The form a route receives.
const (
	// FileField is the form field that carries the file.
	FileField = "file"
	// spoolPrefix starts the name of each upload's temporary file.
	spoolPrefix = "upload-"
	// maxFields and maxFieldBytes bound the form's other fields, which carry an id or a title.
	maxFields     = 16
	maxFieldBytes = 1024
	// formOverhead is what a multipart body carries beyond its file: the boundaries, the parts'
	// headers and the other fields.
	formOverhead = maxFields*(maxFieldBytes+512) + 4096
)

// Receive reads the multipart/form-data body of r, whose file is in its "file" field, to a temporary
// file, and returns it once it has been checked (FR-FL1). It refuses, as problems:
//
//   - 413 payload_too_large, a file over the cap, as soon as the body's length or its bytes show it;
//   - 415 unsupported_media_type, a program, or a type the route does not take;
//   - 422 validation_failed, a body that is not a form, a form with no file or more than one, an
//     empty file, and a field sent twice, over its length or that is not text.
//
// The body may take the pipeline's Timeout to arrive, whatever the server's own deadline for bodies
// (httpx.BodyDeadline); a client that sends it slower is disconnected. The caller closes what it
// returns.
func (s *Service) Receive(w http.ResponseWriter, r *http.Request, rules Rules) (*Upload, error) {
	limit := s.maxBytes
	if rules.MaxBytes > 0 {
		limit = min(limit, rules.MaxBytes)
	}
	if r.ContentLength > limit+formOverhead {
		return nil, problem.New(http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)
	}
	// A writer that cannot set a deadline, a test's recorder, reads without one.
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(s.timeout))

	form, err := r.MultipartReader()
	if err != nil {
		return nil, malformed("")
	}
	u := &Upload{Fields: map[string]string{}}
	ok := false
	defer func() {
		if !ok {
			_ = u.Close()
		}
	}()
	for parts := 0; ; parts++ {
		part, err := form.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, readFailed(err)
		}
		name := part.FormName()
		_, repeated := u.Fields[name]
		// The client names the field, so its pointer is escaped: a field named "a/b" is not b in a.
		field := problem.Pointer(name)
		switch {
		case parts >= maxFields:
			return nil, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldInvalid})
		case name == FileField && u.file != nil:
			return nil, problem.Validation(problem.FieldError{Field: "/" + FileField, Code: problem.FieldInvalid})
		case name == FileField:
			if err := s.spool(u, part, limit); err != nil {
				return nil, err
			}
			u.Filename = cleanName(part.FileName())
		case name == "" || part.FileName() != "":
			return nil, malformed(field)
		case repeated:
			// A field sent twice is refused as a second file is: which of the two a module took, the
			// first or the last, is not the client's to guess, nor a proxy's that added one.
			return nil, problem.Validation(problem.FieldError{Field: field, Code: problem.FieldInvalid})
		default:
			value, err := io.ReadAll(io.LimitReader(part, maxFieldBytes+1))
			switch {
			case err != nil:
				return nil, readFailed(err)
			case len(value) > maxFieldBytes:
				return nil, problem.Validation(problem.FieldError{Field: field, Code: "max_length"})
			case !utf8.Valid(value) || strings.ContainsRune(string(value), 0):
				return nil, malformed(field)
			}
			u.Fields[name] = string(value)
		}
	}
	switch {
	case u.file == nil:
		return nil, problem.Validation(problem.FieldError{Field: "/" + FileField, Code: "required"})
	case u.Size == 0:
		return nil, problem.Validation(problem.FieldError{Field: "/" + FileField, Code: problem.FieldInvalid})
	}
	u.Type = Sniff(u.file, u.Size, u.Filename)
	accept := rules.Accept
	if accept == nil {
		accept = AnyType
	}
	if u.Type.Class == ClassBlocked || !accept(u.Type) {
		return nil, problem.New(http.StatusUnsupportedMediaType, problem.CodeUnsupportedMediaType)
	}
	ok = true
	return u, nil
}

// spool reads the file part to u's temporary file, digesting it as it goes, and refuses one over
// limit.
func (s *Service) spool(u *Upload, part io.Reader, limit int64) error {
	f, err := os.CreateTemp(s.dir, spoolPrefix+"*")
	if err != nil {
		return err
	}
	u.file = f
	h := sha256.New()
	n, err := copyPart(io.MultiWriter(f, h), part, limit)
	if err != nil {
		return err
	}
	u.Size = n
	copy(u.SHA256[:], h.Sum(nil))
	return nil
}

// copyPart copies part to dst, and refuses a part over limit. A part that stops arriving is the
// client's (readFailed); a write that fails is the server's, the disk its uploads are read to full or
// gone, and is the error it is, answered 500, never a body refused as malformed, which no client
// sends again and no user can mend.
func copyPart(dst io.Writer, part io.Reader, limit int64) (int64, error) {
	src := &readErrors{r: io.LimitReader(part, limit+1)}
	n, err := io.Copy(dst, src)
	switch {
	case src.err != nil:
		return n, readFailed(src.err)
	case err != nil:
		return n, fmt.Errorf("files: spool an upload: %w", err)
	case n > limit:
		return n, problem.New(http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)
	}
	return n, nil
}

// readErrors keeps the error its reader answered, other than the end of what it reads, so that a
// copy's failure can be told the reader's from the writer's.
type readErrors struct {
	r   io.Reader
	err error
}

func (e *readErrors) Read(p []byte) (int, error) {
	n, err := e.r.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		e.err = err
	}
	return n, err
}

// readFailed is the answer to a body that stopped arriving: past its deadline the request is
// aborted, as the edge aborts one, since a client that slow reads no answer either; otherwise the
// body is refused as malformed, as the edge refuses one the client stopped sending.
func readFailed(err error) error {
	if errors.Is(err, os.ErrDeadlineExceeded) {
		panic(http.ErrAbortHandler)
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return problem.New(http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)
	}
	return malformed("")
}

func malformed(field string) *problem.Problem {
	return problem.Validation(problem.FieldError{Field: field, Code: problem.FieldMalformed})
}

// maxNameRunes is the longest name a file is saved under, as files.filename holds it.
const maxNameRunes = 255

// cleanName makes the name a client gave a file safe to name a download with: its last path
// element, whichever separator the client's system uses, without control or format characters or
// bytes that are not UTF-8, trimmed, and cut to maxNameRunes with its extension kept. A name that is
// left empty, or is only dots, is none.
func cleanName(name string) string {
	name = strings.ToValidUTF8(name, "�")
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		// A format character, a right-to-left override among them, can make "invoice\u202efdp.exe" read
		// as a PDF's name.
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if strings.Trim(name, ".") == "" || name == "/" {
		return ""
	}
	if runes := []rune(name); len(runes) > maxNameRunes {
		ext := []rune(path.Ext(name))
		if len(ext) > 16 {
			ext = nil
		}
		name = strings.TrimSpace(string(runes[:maxNameRunes-len(ext)])) + string(ext)
	}
	return name
}
