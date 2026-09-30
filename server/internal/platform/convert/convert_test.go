package convert_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/convert"
)

// closeCounter is a body that counts its closes, which the client must never make: the body is
// the caller's file, which it reads again.
type closeCounter struct {
	io.Reader
	closed int
}

func (c *closeCounter) Close() error {
	c.closed++
	return nil
}

// A document the sidecar cannot convert, or will not take, is ErrUnconvertible, which the pipeline
// takes for good, and so is one whose result is empty or over the limit; a sidecar that fails
// otherwise is an error a retry may mend. The caller's body is never closed.
func TestTheSidecarsAnswers(t *testing.T) {
	status, body := http.StatusOK, "%PDF-1.4 converted"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pdf" || r.URL.Query().Get("ext") != "docx" || r.ContentLength != 5 {
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	defer srv.Close()
	c, err := convert.New(srv.URL, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	pdf := func(limit int64) (string, *closeCounter, error) {
		in := &closeCounter{Reader: strings.NewReader("bytes")}
		var out bytes.Buffer
		err := c.PDF(t.Context(), in, 5, "docx", &out, limit)
		return out.String(), in, err
	}

	got, in, err := pdf(100)
	if err != nil || got != body || in.closed != 0 {
		t.Fatalf("converted %q, %v, closed %d times", got, err, in.closed)
	}
	if _, _, err := pdf(5); !errors.Is(err, convert.ErrUnconvertible) {
		t.Errorf("a result over the limit: %v", err)
	}
	for s, want := range map[int]bool{
		http.StatusUnprocessableEntity: true, http.StatusRequestEntityTooLarge: true,
		http.StatusServiceUnavailable: false, http.StatusGatewayTimeout: false, http.StatusInternalServerError: false,
	} {
		status = s
		_, _, err := pdf(100)
		if err == nil || errors.Is(err, convert.ErrUnconvertible) != want {
			t.Errorf("%d: %v", s, err)
		}
	}
	status, body = http.StatusOK, ""
	if _, _, err := pdf(100); !errors.Is(err, convert.ErrUnconvertible) {
		t.Errorf("an empty result: %v", err)
	}
}

func TestNewTakesTheSidecarsURLOnly(t *testing.T) {
	for _, bad := range []string{"", "converter:3100", "ftp://converter", "http://"} {
		if _, err := convert.New(bad, time.Second); err == nil {
			t.Errorf("New(%q) succeeded", bad)
		}
	}
}

// ConverterURLEnv points this test at a running sidecar (deploy/converter), which CI's converter
// job builds and starts. Without it, the test is skipped: the sidecar is not among the services
// every run has.
const ConverterURLEnv = "HOUSEHOLD_TEST_CONVERTER_URL"

// The real sidecar turns a Word document into a PDF, and draws its first page.
func TestTheSidecarConverts(t *testing.T) {
	base := os.Getenv(ConverterURLEnv)
	if base == "" {
		t.Skipf("%s is not set: no sidecar to convert with", ConverterURLEnv)
	}
	c, err := convert.New(base, 3*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	var doc bytes.Buffer
	z := zip.NewWriter(&doc)
	for name, body := range map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Smlouva o dodávce elektřiny</w:t></w:r></w:p></w:body>
</w:document>`,
	} {
		f, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(f, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}

	var pdf bytes.Buffer
	if err := c.PDF(t.Context(), bytes.NewReader(doc.Bytes()), int64(doc.Len()), "docx", &pdf, 100<<20); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(pdf.Bytes(), []byte("%PDF-")) {
		t.Fatalf("the PDF starts %q", pdf.Bytes()[:min(16, pdf.Len())])
	}
	var page bytes.Buffer
	if err := c.Page(t.Context(), bytes.NewReader(pdf.Bytes()), int64(pdf.Len()), 800, &page, 32<<20); err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(&page)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); max(b.Dx(), b.Dy()) != 800 {
		t.Fatalf("the page is %v", b)
	}
	// A damaged document, and a page of what is no PDF, are the document's fault. (LibreOffice reads
	// what no other filter reads as text, so a damaged package is what it cannot convert.)
	var junk bytes.Buffer
	damaged := "PK\x03\x04\x14\x00\x00\x00 the rest of the package is gone"
	if err := c.PDF(t.Context(), strings.NewReader(damaged), int64(len(damaged)), "docx", &junk, 1<<20); !errors.Is(err, convert.ErrUnconvertible) {
		t.Fatalf("a damaged document: %v", err)
	}
	if err := c.Page(t.Context(), strings.NewReader("not a PDF"), 9, 800, &junk, 1<<20); !errors.Is(err, convert.ErrUnconvertible) {
		t.Fatalf("a page of what is no PDF: %v", err)
	}
}
