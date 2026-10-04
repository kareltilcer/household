package objectstore_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func put(t *testing.T, s *objectstore.Store, key string, body []byte, contentType string) error {
	t.Helper()
	return s.PutOnce(t.Context(), key, bytes.NewReader(body), int64(len(body)),
		objectstore.Object{ContentType: contentType, SHA256: sha256.Sum256(body)})
}

// A key once written keeps its bytes: a second write is refused, whatever it carries, and the
// object answers with the digest and the type the first write gave it.
func TestPutOnceWritesAKeyOnce(t *testing.T) {
	s := testsupport.ObjectStore(t)
	first := []byte("Smlouva ČEZ — elektřina")
	if err := put(t, s, "h/a/documents/b/original", first, "text/plain; charset=utf-8"); err != nil {
		t.Fatal(err)
	}
	for _, again := range [][]byte{first, []byte("other bytes")} {
		if err := put(t, s, "h/a/documents/b/original", again, "text/plain"); !errors.Is(err, objectstore.ErrExists) {
			t.Fatalf("a second write = %v, want ErrExists", err)
		}
	}
	info, err := s.Head(t.Context(), "h/a/documents/b/original")
	if err != nil {
		t.Fatal(err)
	}
	if !info.HasSHA256 || info.SHA256 != sha256.Sum256(first) || info.Size != int64(len(first)) ||
		info.ContentType != "text/plain; charset=utf-8" {
		t.Fatalf("head = %+v, want the first write's digest, size and type", info)
	}
	body, _, err := s.Get(t.Context(), "h/a/documents/b/original")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = body.Close() }()
	got, err := io.ReadAll(body)
	if err != nil || !bytes.Equal(got, first) {
		t.Fatalf("get = %q, %v; want the first write's bytes", got, err)
	}
}

// PutSame takes bytes already at a key with the same digest for the caller's own write, whose answer
// was lost, and succeeds; bytes with another digest are another's.
func TestPutSameTakesItsOwnBytesForItsOwn(t *testing.T) {
	s := testsupport.ObjectStore(t)
	same := func(key string, body []byte) error {
		return s.PutSame(t.Context(), key, bytes.NewReader(body), int64(len(body)),
			objectstore.Object{ContentType: "text/plain", SHA256: sha256.Sum256(body)})
	}
	first := []byte("Smlouva ČEZ — elektřina")
	for range 2 {
		if err := same("h/a/documents/b/original", first); err != nil {
			t.Fatalf("the same bytes put again = %v", err)
		}
	}
	if err := same("h/a/documents/b/original", []byte("other bytes")); !errors.Is(err, objectstore.ErrExists) {
		t.Fatalf("other bytes at the key = %v, want ErrExists", err)
	}
}

// racing is a store that answers every write as S3 answers a conditional write racing another to
// its key, 409 ConditionalRequestConflict, and holds at the key what landed: held's bytes, or none
// while the other write is still in flight.
func racing(t *testing.T, held []byte) *objectstore.Store {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPut:
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?>`+
				`<Error><Code>ConditionalRequestConflict</Code><Message>A conflicting operation occurred.</Message></Error>`)
		case r.Method == http.MethodHead && held != nil:
			digest := sha256.Sum256(held)
			w.Header().Set("Content-Type", "text/plain")
			w.Header().Set("Content-Length", strconv.Itoa(len(held)))
			w.Header().Set("X-Amz-Meta-Sha256", hex.EncodeToString(digest[:]))
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	endpoint, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	s, err := objectstore.New(objectstore.Config{
		Location: objectstore.Location{Endpoint: endpoint, Bucket: "racing", AccessKey: "tester", Secret: "racing"},
		Attempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// A write refused because another write to its key was in flight is the store keeping the key
// write-once, as a 412 is, never an outage: PutSame asks which bytes landed, and takes its own for its
// own, refuses another's, and fails, to be tried again, while nothing has landed yet.
func TestAWriteRacingAnotherIsTheKeyTaken(t *testing.T) {
	mine := []byte("Smlouva ČEZ — elektřina")
	object := objectstore.Object{ContentType: "text/plain", SHA256: sha256.Sum256(mine)}
	same := func(s *objectstore.Store) error {
		return s.PutSame(t.Context(), "h/a/documents/b/original", bytes.NewReader(mine), int64(len(mine)), object)
	}
	if err := put(t, racing(t, nil), "h/a/documents/b/original", mine, "text/plain"); !errors.Is(err, objectstore.ErrExists) {
		t.Fatalf("a write racing another = %v, want ErrExists", err)
	}
	if err := same(racing(t, mine)); err != nil {
		t.Fatalf("a write racing its own = %v, want the write", err)
	}
	if err := same(racing(t, []byte("other bytes"))); !errors.Is(err, objectstore.ErrExists) {
		t.Fatalf("a write racing another's = %v, want ErrExists", err)
	}
	if err := same(racing(t, nil)); err == nil || errors.Is(err, objectstore.ErrExists) {
		t.Fatalf("a write racing one still in flight = %v, want a failure to try again", err)
	}
}

// A store that takes a request and stops answering it fails the request once ResponseTimeout has
// passed without an answer beginning, as a store that cannot be reached does: an upload is answered
// 502 and sent again, rather than held for as long as its member waits (FR-NF3). The time runs from
// once the request is sent, its body included, so a large write's transfer never counts against it.
func TestAStoreThatStopsAnsweringFailsTheRequest(t *testing.T) {
	stop := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-stop:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)
	// Before the server closes, which waits for its handlers.
	t.Cleanup(func() { close(stop) })
	endpoint, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	s, err := objectstore.New(objectstore.Config{
		Location: objectstore.Location{Endpoint: endpoint, Bucket: "stalled", AccessKey: "tester", Secret: "stalled"},
		Attempts: 1, ResponseTimeout: 200 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if err := put(t, s, "h/a/documents/b/original", []byte("a photograph"), "image/jpeg"); err == nil || errors.Is(err, objectstore.ErrExists) {
		t.Fatalf("a write the store never answers = %v, want a failure", err)
	}
	if _, err := s.Head(t.Context(), "h/a/documents/b/original"); err == nil || errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("a head the store never answers = %v, want a failure", err)
	}
	if took := time.Since(start); took > 10*time.Second {
		t.Fatalf("the store's silence held the requests %s", took)
	}
}

// The response timeout bounds each attempt, and a store that stops answering is tried three times
// when the configuration names no other number, as the SDK does: a request fails after three of the
// timeouts and the backoff between them, about three minutes in production, which is what ADR 0015
// and the runbook tell an operator to expect, never after the one.
func TestAStoreThatStopsAnsweringIsTriedThreeTimes(t *testing.T) {
	var attempts atomic.Int32
	stop := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-stop:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)
	// Before the server closes, which waits for its handlers.
	t.Cleanup(func() { close(stop) })
	endpoint, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	s, err := objectstore.New(objectstore.Config{
		Location:        objectstore.Location{Endpoint: endpoint, Bucket: "stalled", AccessKey: "tester", Secret: "stalled"},
		ResponseTimeout: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := put(t, s, "h/a/documents/b/original", []byte("a photograph"), "image/jpeg"); err == nil || errors.Is(err, objectstore.ErrExists) {
		t.Fatalf("a write the store never answers = %v, want a failure", err)
	}
	if n := attempts.Load(); n != 3 {
		t.Fatalf("the write was tried %d times, want 3", n)
	}
}

func TestAMissingObjectIsNotFound(t *testing.T) {
	s := testsupport.ObjectStore(t)
	if _, err := s.Head(t.Context(), "h/a/documents/none/original"); !errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("head = %v, want ErrNotFound", err)
	}
	if _, _, err := s.Get(t.Context(), "h/a/documents/none/original"); !errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("get = %v, want ErrNotFound", err)
	}
	// A purge that runs twice succeeds both times.
	if err := s.Delete(t.Context(), "h/a/documents/none/original"); err != nil {
		t.Fatalf("delete of nothing = %v", err)
	}
}

// A bucket that is not there is no object found gone: the files workers would take an original for
// lost, and its file for download-only for good, where the store is what failed, and a purge would
// succeed on bytes it never reached.
func TestAMissingBucketIsNoMissingObject(t *testing.T) {
	s, err := objectstore.New(objectstore.Config{Location: testsupport.ObjectStoreLocation(t, "unmade-bucket"), Attempts: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Get(t.Context(), "h/a/documents/none/original"); err == nil || errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("get from a bucket that is not there = %v, want the store's failure", err)
	}
	if err := s.Delete(t.Context(), "h/a/documents/none/original"); err == nil {
		t.Fatal("a delete from a bucket that is not there succeeded")
	}
}

func TestListAndDeleteKeepToAPrefix(t *testing.T) {
	s := testsupport.ObjectStore(t)
	for _, k := range []string{"h/a/notes/1/original", "h/a/notes/1/thumbnail", "h/a/notes/2/original", "h/b/notes/1/original"} {
		if err := put(t, s, k, []byte(k), "text/plain"); err != nil {
			t.Fatal(err)
		}
	}
	var keys []string
	if err := s.List(t.Context(), "h/a/notes/1/", func(i objectstore.Info) error {
		keys = append(keys, i.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(keys, " ") != "h/a/notes/1/original h/a/notes/1/thumbnail" {
		t.Fatalf("listed %v", keys)
	}
	if err := s.Delete(t.Context(), keys...); err != nil {
		t.Fatal(err)
	}
	keys = nil
	if err := s.List(t.Context(), "h/", func(i objectstore.Info) error {
		keys = append(keys, i.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(keys, " ") != "h/a/notes/2/original h/b/notes/1/original" {
		t.Fatalf("left %v", keys)
	}
}

// An upload of unknown length is written in parts and read back whole: one shorter than a part, one
// that ends past a part's boundary, and one with nothing in it.
func TestUploadWritesABodyOfAnyLengthInParts(t *testing.T) {
	s := testsupport.ObjectStore(t)
	long := make([]byte, objectstore.PartSize+1024)
	var b byte
	for i := range long {
		b += 31
		long[i] = b
	}
	for name, body := range map[string][]byte{"short": []byte("an archive"), "long": long, "empty": {}} {
		key := "u/a/exports/b/" + name
		// A reader that yields a few bytes at a time, as an archive being built does.
		n, err := s.Upload(t.Context(), key, iotest(bytes.NewReader(body)), "application/zip")
		if err != nil || n != int64(len(body)) {
			t.Fatalf("upload %s = %d, %v; want %d bytes", name, n, err, len(body))
		}
		got, info, err := s.Get(t.Context(), key)
		if err != nil {
			t.Fatal(err)
		}
		read, err := io.ReadAll(got)
		_ = got.Close()
		if err != nil || sha256.Sum256(read) != sha256.Sum256(body) || info.ContentType != "application/zip" {
			t.Fatalf("%s read back as %d bytes of %q, %v; want the %d uploaded as application/zip", name, len(read), info.ContentType, err, len(body))
		}
	}
	if _, err := s.Upload(t.Context(), "u/a/../b", strings.NewReader("x"), "application/zip"); !errors.Is(err, objectstore.ErrInvalidKey) {
		t.Fatalf("an upload to a key outside the form = %v, want ErrInvalidKey", err)
	}
}

// iotest yields r's bytes in short reads.
func iotest(r io.Reader) io.Reader { return shortReader{r} }

type shortReader struct{ r io.Reader }

func (s shortReader) Read(p []byte) (int, error) {
	if len(p) > 64<<10 {
		p = p[:64<<10]
	}
	return s.r.Read(p)
}

// An upload whose body fails keeps nothing at its key, whatever the body failed with: a connection
// that dropped under whoever was writing it fails with an unexpected end, which is no end of the body.
func TestAFailedUploadLeavesNoObject(t *testing.T) {
	s := testsupport.ObjectStore(t)
	for name, failure := range map[string]error{
		"broken": errors.New("the archive could not be built"),
		"cut":    io.ErrUnexpectedEOF,
		"ended":  fmt.Errorf("the archive's source: %w", io.EOF),
	} {
		key := "u/a/exports/b/" + name
		broken := io.MultiReader(strings.NewReader("half an archive"), failingReader{failure})
		if _, err := s.Upload(t.Context(), key, broken, "application/zip"); !errors.Is(err, failure) {
			t.Fatalf("an upload whose body failed with %v = %v, want it failed with that", failure, err)
		}
		if _, err := s.Head(t.Context(), key); !errors.Is(err, objectstore.ErrNotFound) {
			t.Fatalf("head of %s = %v, want ErrNotFound", name, err)
		}
	}
}

// failingReader fails every read with err.
type failingReader struct{ err error }

func (f failingReader) Read([]byte) (int, error) { return 0, f.err }

// RemoveAll removes everything under a household's or an account's prefix and nothing beside it, and
// refuses a prefix that could name more.
func TestRemoveAllKeepsToItsPrefix(t *testing.T) {
	s := testsupport.ObjectStore(t)
	for _, k := range []string{"h/a/notes/1/original", "h/a/documents/2/original", "h/ab/notes/1/original", "u/a/avatar/1/picture"} {
		if err := put(t, s, k, []byte(k), "text/plain"); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.RemoveAll(t.Context(), "h/a/"); err != nil || n != 2 {
		t.Fatalf("remove all = %d, %v; want the household's 2 objects", n, err)
	}
	var keys []string
	if err := s.List(t.Context(), "", func(i objectstore.Info) error {
		keys = append(keys, i.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(keys, " ") != "h/ab/notes/1/original u/a/avatar/1/picture" {
		t.Fatalf("left %v", keys)
	}
	for _, p := range []string{"", "h/", "h/a", "/", "h//", "u/a/../"} {
		if _, err := s.RemoveAll(t.Context(), p); !errors.Is(err, objectstore.ErrInvalidKey) {
			t.Errorf("remove all %q = %v, want ErrInvalidKey", p, err)
		}
	}
}

// RemoveAll says how many objects it removed, not how many it listed: a store that refuses a removal
// partway leaves the rest, and the erasure that asked counts only what went.
func TestRemoveAllCountsWhatItRemoved(t *testing.T) {
	keys := []string{"h/a/documents/1/original", "h/a/documents/2/original", "h/a/documents/3/original"}
	var deletes atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		switch {
		case r.Method == http.MethodGet:
			listing := `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
				`<Name>refusing</Name><Prefix>h/a/</Prefix><KeyCount>3</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>`
			for _, k := range keys {
				listing += `<Contents><Key>` + k + `</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>`
			}
			_, _ = io.WriteString(w, listing+`</ListBucketResult>`)
		case r.Method == http.MethodDelete && deletes.Add(1) == 1:
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>We encountered an internal error.</Message></Error>`)
		}
	}))
	t.Cleanup(srv.Close)
	endpoint, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	s, err := objectstore.New(objectstore.Config{
		Location: objectstore.Location{Endpoint: endpoint, Bucket: "refusing", AccessKey: "tester", Secret: "refusing"},
		Attempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := s.RemoveAll(t.Context(), "h/a/"); err == nil || n != 1 {
		t.Fatalf("remove all = %d, %v; want the one object removed before the store refused, and the refusal", n, err)
	}
	if n := deletes.Load(); n != 2 {
		t.Fatalf("the store was asked for %d removals, want it to stop at the one refused", n)
	}
}

func TestAKeyOutsideTheFormIsRefused(t *testing.T) {
	s := testsupport.ObjectStore(t)
	for _, k := range []string{"", "/h/a", "h/../b", "h/a/", "H/a", "h//a", "h/a b"} {
		if err := put(t, s, k, []byte("x"), "text/plain"); !errors.Is(err, objectstore.ErrInvalidKey) {
			t.Errorf("put %q = %v, want ErrInvalidKey", k, err)
		}
		if _, _, err := s.Presign(t.Context(), k, objectstore.Presentation{}, time.Now()); !errors.Is(err, objectstore.ErrInvalidKey) {
			t.Errorf("presign %q = %v, want ErrInvalidKey", k, err)
		}
	}
}

// A pre-signed URL fetches its one object as it presents it, for the fifteen minutes from the start
// of the five it was issued in, and every URL issued in those five minutes is the same one.
func TestPresignFetchesOneObjectForMinutes(t *testing.T) {
	s := testsupport.ObjectStore(t)
	body := []byte("<svg xmlns='http://www.w3.org/2000/svg'/>")
	if err := put(t, s, "h/a/documents/c/original", body, "image/svg+xml"); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	link, expires, err := s.Presign(t.Context(), "h/a/documents/c/original", objectstore.Presentation{
		ContentType: "image/svg+xml", Disposition: objectstore.Attachment, Filename: "Plán zahrady.svg",
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if min, max := now.Add(10*time.Minute), now.Add(15*time.Minute); expires.Before(min.Add(-time.Second)) || expires.After(max) {
		t.Fatalf("expires %s, want between %s and %s", expires, min, max)
	}
	again, _, err := s.Presign(t.Context(), "h/a/documents/c/original", objectstore.Presentation{
		ContentType: "image/svg+xml", Disposition: objectstore.Attachment, Filename: "Plán zahrady.svg",
	}, now.Truncate(objectstore.LinkWindow).Add(objectstore.LinkWindow-time.Second))
	if err != nil || again != link {
		t.Fatalf("a link issued later in the same window differs:\n%s\n%s", link, again)
	}

	res := fetch(t, link)
	if res.StatusCode != http.StatusOK || !bytes.Equal(res.Body, body) {
		t.Fatalf("fetch = %d %q", res.StatusCode, res.Body)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") || !strings.Contains(cd, "filename*=utf-8''Pl%C3%A1n%20zahrady.svg") {
		t.Errorf("Content-Disposition = %q", cd)
	}

	// The URL names one object: pointed at another, its signature no longer holds.
	other, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	other.Path = strings.Replace(other.Path, "/c/", "/d/", 1)
	if res := fetch(t, other.String()); res.StatusCode != http.StatusForbidden {
		t.Errorf("another key under the same signature = %d, want 403", res.StatusCode)
	}
	// Signed in a window long past, it has expired.
	old, _, err := s.Presign(t.Context(), "h/a/documents/c/original", objectstore.Presentation{}, now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if res := fetch(t, old); res.StatusCode != http.StatusForbidden {
		t.Errorf("an expired link = %d, want 403", res.StatusCode)
	}
}

// fetched is what a client reads from a link.
type fetched struct {
	StatusCode int
	Header     http.Header
	Body       []byte
}

func fetch(t *testing.T, link string) fetched {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, link, nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return fetched{StatusCode: res.StatusCode, Header: res.Header, Body: body}
}

func TestParseURL(t *testing.T) {
	loc, err := objectstore.ParseURL("https://key:se%2Fcret@s3.example.eu:9000/household?region=eu-central-1")
	if err != nil {
		t.Fatal(err)
	}
	if loc.Endpoint.String() != "https://s3.example.eu:9000" || loc.Bucket != "household" || loc.Region != "eu-central-1" ||
		loc.AccessKey != "key" || loc.Secret != "se/cret" {
		t.Fatalf("parsed %+v", loc)
	}
	if loc, err := objectstore.ParseURL("http://k:s@127.0.0.1:9000/household"); err != nil || loc.Region != objectstore.DefaultRegion {
		t.Fatalf("no region = %+v, %v; want the default", loc, err)
	}
	for _, bad := range []string{
		"ftp://k:s@host/bucket", "http://k:s@/bucket", "http://k:s@host", "http://k:s@host/a/b",
		"http://host/bucket", "http://k@host/bucket", "http://k:s@host/UPPER",
	} {
		if _, err := objectstore.ParseURL(bad); err == nil {
			t.Errorf("ParseURL(%q) succeeded", bad)
		} else if strings.Contains(err.Error(), ":s@") {
			t.Errorf("the error names the secret: %v", err)
		}
	}
}
