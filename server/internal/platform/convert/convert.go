// Package convert is the client of the converter sidecar (cmd/converter, deploy/converter; plan item
// 14, Q14): LibreOffice headless, which turns an office document into a PDF, and poppler, which
// draws a PDF's first page, each under a timeout of the sidecar's own. The files pipeline derives a
// document's variants through it after the upload commits (FR-FL3); what it cannot convert stays
// download-only, and never loses the upload.
//
// The sidecar takes the bytes as the body of a POST and answers with the result:
//
//	POST /pdf?ext=docx     an office document → application/pdf
//	POST /page?side=1600   a PDF → its first page as image/png, its longer side side pixels
//
// It answers 422 for a document it cannot convert and 413 for one larger than it takes, which are
// the document's and will not change, and 503 or 504 for a sidecar too busy, a conversion the system
// killed or one that ran out of time, and 500 for a command it could not start, which a retry may
// not meet.
package convert

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ErrUnconvertible is the answer for a document the sidecar cannot convert: retrying will not help.
var ErrUnconvertible = errors.New("convert: the document cannot be converted")

// Client is the sidecar's client.
type Client struct {
	base *url.URL
	http *http.Client
}

// New returns the client of the sidecar at base, whose requests each give up after timeout, which
// is longer than the sidecar's own wait for a slot and its conversion's together, so that the
// sidecar's answer arrives first.
func New(base string, timeout time.Duration) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("convert: %q is not the sidecar's http or https URL", base)
	}
	return &Client{base: &url.URL{Scheme: u.Scheme, Host: u.Host, Path: u.Path}, http: &http.Client{Timeout: timeout}}, nil
}

// PDF converts the size bytes body reads, an office document whose usual extension is ext, into a
// PDF, which it copies to w, up to limit bytes.
func (c *Client) PDF(ctx context.Context, body io.Reader, size int64, ext string, w io.Writer, limit int64) error {
	return c.post(ctx, "pdf", url.Values{"ext": {ext}}, body, size, w, limit)
}

// Page draws the first page of the PDF body reads, its longer side side pixels, as a PNG it copies
// to w, up to limit bytes.
func (c *Client) Page(ctx context.Context, body io.Reader, size int64, side int, w io.Writer, limit int64) error {
	return c.post(ctx, "page", url.Values{"side": {strconv.Itoa(side)}}, body, size, w, limit)
}

func (c *Client) post(ctx context.Context, path string, query url.Values, body io.Reader, size int64, w io.Writer, limit int64) error {
	u := *c.base
	u.Path += "/" + path
	u.RawQuery = query.Encode()
	// The client closes a body that can be closed once it is sent; the caller's file is the caller's
	// to close, and to read again.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), struct{ io.Reader }{body})
	if err != nil {
		return err
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("convert: %s: %w", path, err)
	}
	defer func() { _ = res.Body.Close() }()
	switch {
	case res.StatusCode == http.StatusUnprocessableEntity, res.StatusCode == http.StatusRequestEntityTooLarge:
		return ErrUnconvertible
	case res.StatusCode != http.StatusOK:
		return fmt.Errorf("convert: %s: the sidecar answered %d", path, res.StatusCode)
	}
	n, err := io.Copy(w, io.LimitReader(res.Body, limit+1))
	switch {
	case err != nil:
		return fmt.Errorf("convert: %s: %w", path, err)
	case n > limit:
		return fmt.Errorf("%w: %s: the result is larger than %d bytes", ErrUnconvertible, path, limit)
	case n == 0:
		return ErrUnconvertible
	}
	return nil
}
