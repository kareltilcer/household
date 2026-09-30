package objectstore_test

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
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

func TestAKeyOutsideTheFormIsRefused(t *testing.T) {
	s := testsupport.ObjectStore(t)
	for _, k := range []string{"", "/h/a", "h/../b", "h/a/", "H/a", "h//a", "h/a b"} {
		if err := put(t, s, k, []byte("x"), "text/plain"); err == nil {
			t.Errorf("put %q succeeded", k)
		}
		if _, _, err := s.Presign(t.Context(), k, objectstore.Presentation{}, time.Now()); err == nil {
			t.Errorf("presign %q succeeded", k)
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
