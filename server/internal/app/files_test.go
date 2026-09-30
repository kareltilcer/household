package app_test

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/app/testdata/probe"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/convert"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file upload through the probe module, which keeps a file for each item it makes
// the way a module keeps a document, to prove what the files pipeline does to every module's uploads
// (plan item 14): what it refuses, what it stores and records, the links it issues and to whom, the
// variants it derives after the commit, and the bytes it purges and sweeps.

// fileWorld is a world whose probe keeps its files through a pipeline of its own, on a bucket of the
// test's own.
type fileWorld struct {
	*world
	files *files.Service
	// workLog is what the pipeline logs, its workers among it.
	workLog *syncBuffer
}

// newFileWorld builds a file world, whose pipeline each of limits adjusts. Its storage picture
// labels by the modules the router serves, as the server's does.
func newFileWorld(t *testing.T, limits ...func(*files.Config)) *fileWorld {
	t.Helper()
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	workLog := &syncBuffer{}
	fs := apptest.Files(t, pool, logging.New(workLog, slog.LevelDebug), apptest.Options{}, limits...)
	w := newWorld(t, func(d *app.Deps) {
		registry, err := module.NewRegistry(probe.Module{Log: d.Logger, Files: fs})
		if err != nil {
			t.Fatal(err)
		}
		d.Modules = registry
	})
	return &fileWorld{world: w, files: fs, workLog: workLog}
}

func uploads(household uuid.UUID) string {
	return fmt.Sprintf("/api/v1/households/%s/probe/files", household)
}

func filePath(household, item uuid.UUID) string {
	return fmt.Sprintf("%s/%s", uploads(household), item)
}

// form is a multipart/form-data body, its fields in order and a file part named name carrying
// content when content is not nil, and the media type that names its boundary.
func form(t *testing.T, name string, content []byte, fields map[string]string) (string, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, k := range slices.Sorted(maps.Keys(fields)) {
		if err := w.WriteField(k, fields[k]); err != nil {
			t.Fatal(err)
		}
	}
	if content != nil {
		part, err := w.CreateFormFile(files.FileField, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.String(), w.FormDataContentType()
}

// upload sends content, named name, to the probe's uploads as user, with fields.
func (w *fileWorld) upload(household, user uuid.UUID, name string, content []byte, fields map[string]string) *httptest.ResponseRecorder {
	w.t.Helper()
	body, contentType := form(w.t, name, content, fields)
	return w.send(http.MethodPost, uploads(household), user, body, http.Header{"Content-Type": {contentType}})
}

// picture is a w by h PNG, opaque, in two colours.
func picture(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// fileRow is a files row as the administrator reads it.
type fileRow struct {
	contentType string
	size        int64
	sha         []byte
	filename    *string
	owner       *uuid.UUID
	private     bool
	variants    *string
}

// rows returns the files rows of item, by variant.
func (w *fileWorld) rows(household, item uuid.UUID) map[string]fileRow {
	w.t.Helper()
	rows, err := w.admin.Query(w.t.Context(), `
		SELECT variant, content_type, byte_size, sha256, filename, owner_id, private, variants
		FROM files WHERE household_id = $1 AND module = 'probe' AND entity_id = $2`, household, item)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]fileRow{}
	for rows.Next() {
		var (
			variant string
			r       fileRow
		)
		if err := rows.Scan(&variant, &r.contentType, &r.size, &r.sha, &r.filename, &r.owner, &r.private, &r.variants); err != nil {
			w.t.Fatal(err)
		}
		out[variant] = r
	}
	return out
}

// variantsOf is the state of the variants of item's original, "" for none.
func (w *fileWorld) variantsOf(household, item uuid.UUID) string {
	w.t.Helper()
	if v := w.rows(household, item)[files.Original].variants; v != nil {
		return *v
	}
	return ""
}

// jobs returns the kinds of the jobs waiting for item.
func (w *fileWorld) jobs(household, item uuid.UUID) []string {
	w.t.Helper()
	rows, err := w.admin.Query(w.t.Context(),
		"SELECT kind FROM file_jobs WHERE household_id = $1 AND entity_id = $2 ORDER BY kind", household, item)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			w.t.Fatal(err)
		}
		out = append(out, k)
	}
	return out
}

// objects lists the keys the bucket holds under prefix.
func (w *fileWorld) objects(prefix string) []string {
	w.t.Helper()
	var keys []string
	if err := w.files.Store().List(w.t.Context(), prefix, func(i objectstore.Info) error {
		keys = append(keys, i.Key)
		return nil
	}); err != nil {
		w.t.Fatal(err)
	}
	return keys
}

// linkDoc is the contract's ContentLink, as a client reads it.
type linkDoc struct {
	URL         string    `json:"url"`
	ExpiresAt   time.Time `json:"expires_at"`
	ContentType string    `json:"content_type"`
	ByteSize    int64     `json:"byte_size"`
	Disposition string    `json:"disposition"`
	ETag        string    `json:"etag"`
}

// link asks for a link to item's variant as user, and expects 200.
func (w *fileWorld) link(household, item, user uuid.UUID, variant string) linkDoc {
	w.t.Helper()
	path := filePath(household, item)
	if variant != "" {
		path += "?variant=" + variant
	}
	rec := w.do(http.MethodGet, path, user, "")
	expect(w.t, rec, http.StatusOK, "")
	var l linkDoc
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil {
		w.t.Fatal(err)
	}
	return l
}

// fetched is what a client reads from a link.
type fetched struct {
	status int
	header http.Header
	body   []byte
}

// fetchLink gets a link's URL, as a client would, from the store.
func fetchLink(t *testing.T, link string) fetched {
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
	return fetched{status: res.StatusCode, header: res.Header, body: body}
}

// An upload is stored once under its entity's key, with its digest, and recorded with its audit
// event and its change; the same bytes sent again store and record nothing twice, and other bytes for
// the same entity are refused, since bytes are write-once (FR-FL1). Its variants are derived after
// the commit (FR-FL3), and a link fetches each object as it was stored, for minutes (FR-FL2, D-9).
func TestAnUploadIsStoredOnceAndLinkedForMinutes(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	content := picture(t, 2000, 1000)
	digest := sha256.Sum256(content)

	rec := w.upload(h, jana, "C:\\Users\\jana\\Zahrada\\záhon.png", content, map[string]string{"id": item.String()})
	expect(t, rec, http.StatusCreated, "")
	var got probe.File
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ContentType != "image/png" || got.ByteSize != int64(len(content)) {
		t.Fatalf("answered %+v", got)
	}
	rows := w.rows(h, item)
	original, ok := rows[files.Original]
	if !ok || len(rows) != 1 || original.contentType != "image/png" || original.size != int64(len(content)) ||
		!bytes.Equal(original.sha, digest[:]) || original.filename == nil || *original.filename != "záhon.png" ||
		original.owner == nil || *original.owner != jana || original.private || *original.variants != "pending" {
		t.Fatalf("rows %+v", rows)
	}
	if jobs := w.jobs(h, item); !slices.Equal(jobs, []string{"variants"}) {
		t.Fatalf("jobs %v", jobs)
	}
	var events int
	if err := w.admin.QueryRow(t.Context(),
		"SELECT count(*) FROM audit_events WHERE household_id = $1 AND entity_id = $2 AND action = 'item.create'", h, item).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("%d events recorded the upload", events)
	}
	info, err := w.files.Store().Head(t.Context(), files.Key(h, probe.Name, item, files.Original))
	if err != nil || !info.HasSHA256 || info.SHA256 != digest || info.ContentType != "image/png" {
		t.Fatalf("the stored object: %+v, %v", info, err)
	}

	// The same bytes again: answered alike, recorded once.
	expect(t, w.upload(h, jana, "záhon.png", content, map[string]string{"id": item.String()}), http.StatusCreated, "")
	if rows := w.rows(h, item); len(rows) != 1 {
		t.Fatalf("a retry recorded %d rows", len(rows))
	}
	// Other bytes for the same entity: refused, the stored bytes untouched.
	rec = w.upload(h, jana, "záhon.png", picture(t, 10, 10), map[string]string{"id": item.String()})
	expect(t, rec, http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	if errs := fieldErrorsOf(t, rec); len(errs) != 1 || errs[0].Field != "/id" {
		t.Fatalf("errors %v", errs)
	}
	if info, err := w.files.Store().Head(t.Context(), files.Key(h, probe.Name, item, files.Original)); err != nil || info.SHA256 != digest {
		t.Fatalf("the stored bytes changed: %+v, %v", info, err)
	}

	// The variants, derived after the commit: a thumbnail, and a preview of a picture larger than one.
	w.files.Drain(t.Context(), h)
	rows = w.rows(h, item)
	if *rows[files.Original].variants != "ready" || len(rows) != 3 || len(w.jobs(h, item)) != 0 {
		t.Fatalf("after the job: rows %+v, jobs %v", rows, w.jobs(h, item))
	}
	for variant, side := range map[string]int{files.Thumbnail: 320, files.Preview: 1600} {
		r := rows[variant]
		if r.owner == nil || *r.owner != jana || r.variants != nil || r.filename != nil {
			t.Errorf("%s: %+v", variant, r)
		}
		l := w.link(h, item, jana, variant)
		res := fetchLink(t, l.URL)
		cfg, _, err := image.DecodeConfig(bytes.NewReader(res.body))
		if err != nil || res.status != http.StatusOK || cfg.Width != side || cfg.Height != side/2 {
			t.Errorf("%s: %d, %dx%d, %v", variant, res.status, cfg.Width, cfg.Height, err)
		}
		if l.ContentType != r.contentType || l.ByteSize != r.size || l.Disposition != "inline" {
			t.Errorf("%s's link %+v", variant, l)
		}
	}

	now := time.Now()
	l := w.link(h, item, jana, "")
	if l.ContentType != "image/png" || l.ByteSize != int64(len(content)) || l.Disposition != "inline" ||
		l.ETag != hex.EncodeToString(digest[:]) || l.ExpiresAt.Before(now.Add(9*time.Minute)) || l.ExpiresAt.After(now.Add(16*time.Minute)) {
		t.Fatalf("link %+v", l)
	}
	res := fetchLink(t, l.URL)
	if res.status != http.StatusOK || !bytes.Equal(res.body, content) || res.header.Get("Content-Type") != "image/png" {
		t.Fatalf("the link fetched %d, %s, %d bytes", res.status, res.header.Get("Content-Type"), len(res.body))
	}
	if cd := res.header.Get("Content-Disposition"); !strings.HasPrefix(cd, "inline;") || !strings.Contains(cd, "z%C3%A1hon.png") {
		t.Errorf("Content-Disposition %q", cd)
	}
}

// The refusal matrix (plan item 14): 413 for a file over the cap, 415 for a program or a type the
// route does not take, 422 for a form with no file, an empty file or no id, 402 for an upload past
// the storage ceiling, naming by how much, and 502 for a store that cannot be reached, which commits
// nothing. None records anything.
func TestTheRefusalMatrix(t *testing.T) {
	ceiling := storage.Allowance{Base: 2000, Block: 1000, MaxBlocks: 1}
	w := newFileWorld(t, func(c *files.Config) {
		c.MaxBytes = 1000
		c.Allowance = ceiling
	})
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	id := func() map[string]string { return map[string]string{"id": idgen.New().String()} }

	rec := w.upload(h, jana, "big.txt", bytes.Repeat([]byte("a"), 1001), id())
	expect(t, rec, http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)

	elf := append([]byte("\x7fELF\x02\x01\x01"), make([]byte, 64)...)
	expect(t, w.upload(h, jana, "tool", elf, id()), http.StatusUnsupportedMediaType, problem.CodeUnsupportedMediaType)
	// A program is blocked by its name as well, whatever its bytes are.
	expect(t, w.upload(h, jana, "invoice.pdf.exe", []byte("%PDF-1.7\n"), id()), http.StatusUnsupportedMediaType,
		problem.CodeUnsupportedMediaType)

	for name, fields := range map[string]struct {
		content []byte
		fields  map[string]string
		field   string
	}{
		"no file":    {nil, id(), "/file"},
		"empty file": {[]byte{}, id(), "/file"},
		"no id":      {[]byte("text"), nil, "/id"},
	} {
		rec := w.upload(h, jana, "note.txt", fields.content, fields.fields)
		expect(t, rec, http.StatusUnprocessableEntity, problem.CodeValidationFailed)
		if errs := fieldErrorsOf(t, rec); len(errs) != 1 || errs[0].Field != fields.field {
			t.Errorf("%s: %v", name, errs)
		}
	}

	// Up to the ceiling every upload succeeds; past it, the upload is refused by how much.
	for range 3 {
		expect(t, w.upload(h, jana, "note.txt", bytes.Repeat([]byte("b"), 900), id()), http.StatusCreated, "")
	}
	rec = w.upload(h, jana, "note.txt", bytes.Repeat([]byte("c"), 900), id())
	expect(t, rec, http.StatusPaymentRequired, problem.CodeStorageCeilingReached)
	var refusal struct {
		State           string `json:"state"`
		Remedy          string `json:"remedy"`
		OverBy          int64  `json:"over_by_bytes"`
		BlocksAtCeiling int    `json:"blocks_at_ceiling"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &refusal); err != nil {
		t.Fatal(err)
	}
	if refusal.State != "trialing" || refusal.Remedy != "free_storage" || refusal.OverBy != 600 || refusal.BlocksAtCeiling != 1 {
		t.Fatalf("402 %+v", refusal)
	}

	var items int
	if err := w.admin.QueryRow(t.Context(), "SELECT count(*) FROM probe_items WHERE household_id = $1", h).Scan(&items); err != nil {
		t.Fatal(err)
	}
	if items != 3 {
		t.Fatalf("%d items made, want the 3 accepted", items)
	}

	// A store that cannot be reached: 502, and nothing is recorded.
	down := newFileWorld(t, func(c *files.Config) {
		store, err := objectstore.New(objectstore.Config{Location: objectstore.Location{
			Endpoint: &url.URL{Scheme: "http", Host: "127.0.0.1:1"}, Bucket: "down", AccessKey: "k", Secret: "s",
		}, Attempts: 1})
		if err != nil {
			t.Fatal(err)
		}
		c.Store = store
	})
	h = down.household(true)
	jana = down.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, down.upload(h, jana, "note.txt", []byte("text"), map[string]string{"id": item.String()}),
		http.StatusBadGateway, problem.CodeStorageUnavailable)
	if n := down.count(item); n != 0 || len(down.rows(h, item)) != 0 {
		t.Fatalf("a refused upload recorded %d items, %d files", n, len(down.rows(h, item)))
	}
}

// No link is issued before authorisation (FR-FL2, D-9): not to a member the module is absent for,
// nor for another member's private file, nor to anyone outside the household, nor to nobody; each is
// the 404 a missing file is, since a 403 would say it exists (D-16).
func TestNoLinkIsIssuedBeforeAuthorisation(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	petr := w.member(h, access.Member, level(access.Contribute))
	klara := w.member(h, access.Member, level(access.None))
	stranger := w.member(w.household(true), access.Owner, nil)

	shared, private := idgen.New(), idgen.New()
	expect(t, w.upload(h, jana, "shared.txt", []byte("shared"), map[string]string{"id": shared.String()}), http.StatusCreated, "")
	expect(t, w.upload(h, jana, "private.png", picture(t, 50, 50),
		map[string]string{"id": private.String(), "private": "true"}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	if r := w.rows(h, private)[files.Original]; !r.private || r.owner == nil || *r.owner != jana {
		t.Fatalf("the private file's row %+v", r)
	}

	w.link(h, shared, jana, "")
	w.link(h, private, jana, "")
	w.link(h, shared, petr, "")
	for name, tc := range map[string]struct {
		item, user uuid.UUID
		status     int
	}{
		"another member's private file":    {private, petr, http.StatusNotFound},
		"a member the module is absent to": {shared, klara, http.StatusNotFound},
		"a stranger":                       {shared, stranger, http.StatusNotFound},
		"nobody":                           {shared, uuid.Nil, http.StatusUnauthorized},
		"a file that is not there":         {idgen.New(), jana, http.StatusNotFound},
	} {
		rec := w.do(http.MethodGet, filePath(h, tc.item), tc.user, "")
		if rec.Code != tc.status || strings.Contains(rec.Body.String(), "X-Amz-Signature") {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	// A variant is held to its original's privacy.
	w.link(h, private, jana, files.Thumbnail)
	rec := w.do(http.MethodGet, filePath(h, private)+"?variant=thumbnail", petr, "")
	expect(t, rec, http.StatusNotFound, problem.CodeNotFound)
}

// A child profile's private file is its household's owners' to open, as D-19 makes a child's private
// items readable by them (FR-CH3): its link is issued to them, and the storage picture lists it among
// their largest items. It stays another adult's to open by nobody, and an adult's private file stays
// no owner's to open (D-108).
func TestAChildsPrivateFileIsItsOwnersToOpen(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	w.exec(testsupport.InsertEnablement, h, storage.Admin, true)
	jana := w.member(h, access.Owner, nil)
	petr := w.member(h, access.Member, level(access.Contribute))
	w.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, $3, 'view')", h, petr, storage.Admin)
	ema := w.member(h, access.Child, level(access.Contribute))
	emas, petrs := idgen.New(), idgen.New()
	expect(t, w.upload(h, ema, "deník.txt", []byte("Ema's diary"),
		map[string]string{"id": emas.String(), "private": "true"}), http.StatusCreated, "")
	expect(t, w.upload(h, petr, "poznámky.txt", []byte("Petr's own notes"),
		map[string]string{"id": petrs.String(), "private": "true"}), http.StatusCreated, "")

	w.link(h, emas, ema, "")
	w.link(h, emas, jana, "")
	w.link(h, petrs, petr, "")
	expect(t, w.do(http.MethodGet, filePath(h, emas), petr, ""), http.StatusNotFound, problem.CodeNotFound)
	expect(t, w.do(http.MethodGet, filePath(h, petrs), jana, ""), http.StatusNotFound, problem.CodeNotFound)

	largest := func(reader uuid.UUID) []uuid.UUID {
		t.Helper()
		rec := w.do(http.MethodGet, "/api/v1"+householdPath(h, "/storage"), reader, "")
		expect(t, rec, http.StatusOK, "")
		var r reportDoc
		decode(t, rec, &r)
		var out []uuid.UUID
		for _, it := range r.Largest {
			out = append(out, it.EntityID)
		}
		return out
	}
	if got := largest(jana); !slices.Equal(got, []uuid.UUID{emas}) {
		t.Fatalf("the owner's largest items %v, want the child's %v alone", got, emas)
	}
	if got := largest(petr); !slices.Equal(got, []uuid.UUID{petrs}) {
		t.Fatalf("another adult's largest items %v, want his own %v alone", got, petrs)
	}
}

// A module moves an entity to another member, or between shared and private, and every object of it
// moves with it (FR-ST1): its original and the variants derived from it, which the storage picture
// and the sample count against the member they name, and its link follows. A variant a worker is
// recording as the entity moves moves with it too, rather than counting against the member the
// entity left.
func TestAnEntitysObjectsMoveWithIt(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	petr := w.member(h, access.Member, level(access.Contribute))
	item := idgen.New()
	expect(t, w.upload(h, jana, "a.png", picture(t, 400, 400), map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	scoped := tenant.Assume(t.Context(), testsupport.Open(t).Pool(t, db.RoleApp), h, uuid.Nil, "")
	attribute := func(a files.Attribution) error {
		return tenant.InWriteTx(scoped, func(tx pgx.Tx) error { return files.Attribute(scoped, tx, probe.Name, item, a) })
	}

	if err := attribute(files.Attribution{Owner: petr, Private: true}); err != nil {
		t.Fatal(err)
	}
	rows := w.rows(h, item)
	for variant, r := range rows {
		if r.owner == nil || *r.owner != petr || !r.private {
			t.Errorf("%s: %+v", variant, r)
		}
	}
	if len(rows) != 2 {
		t.Fatalf("rows %+v", rows)
	}
	w.link(h, item, petr, "")
	expect(t, w.do(http.MethodGet, filePath(h, item), jana, ""), http.StatusNotFound, problem.CodeNotFound)
	if err := attribute(files.Attribution{Private: true}); err == nil {
		t.Fatal("an entity private to nobody was attributed")
	}

	// A worker's transaction holds the original, as it does to record what it derived, and has
	// recorded a variant under the attribution it read; the move waits for it, and takes the variant.
	moved := make(chan error, 1)
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if _, err := tx.Exec(scoped, `
			SELECT FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original' FOR UPDATE`,
			h, probe.Name, item); err != nil {
			return err
		}
		if _, err := tx.Exec(scoped, `
			INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, owner_id, private)
			VALUES ($1, $2, $3, 'preview', 'image/jpeg', 10, $4, $5, true)`,
			h, probe.Name, item, make([]byte, 32), petr); err != nil {
			return err
		}
		go func() { moved <- attribute(files.Attribution{Owner: jana}) }()
		waitForALock(t, w)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := <-moved; err != nil {
		t.Fatal(err)
	}
	rows = w.rows(h, item)
	for variant, r := range rows {
		if r.owner == nil || *r.owner != jana || r.private {
			t.Errorf("after the move beside a worker, %s: %+v", variant, r)
		}
	}
	if len(rows) != 3 {
		t.Fatalf("rows %+v", rows)
	}
}

// waitForALock waits until a transaction of w's database waits for a lock another holds.
func waitForALock(t *testing.T, w *fileWorld) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		var waiting int
		if err := w.admin.QueryRow(t.Context(), `
			SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			return
		}
	}
	t.Fatal("no transaction waited for the lock")
}

// An active type is a download, never rendered (FR-FL2): an SVG is kept as one, and its link saves
// it.
func TestAnActiveTypeIsADownload(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	expect(t, w.upload(h, jana, "plan.png", svg, map[string]string{"id": item.String()}), http.StatusCreated, "")
	if r := w.rows(h, item)[files.Original]; r.contentType != "image/svg+xml" || *r.variants != "none" {
		t.Fatalf("the SVG was kept as %+v", r)
	}
	l := w.link(h, item, jana, "")
	if l.Disposition != "attachment" || l.ContentType != "image/svg+xml" {
		t.Fatalf("link %+v", l)
	}
	if cd := fetchLink(t, l.URL).header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Fatalf("Content-Disposition %q", cd)
	}
}

// A deleted entity's rows go in its mutation, and its bytes after the commit, every variant with
// them.
func TestADeletedEntitysBytesArePurged(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, w.upload(h, jana, "a.png", picture(t, 400, 400), map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	prefix := files.Key(h, probe.Name, item, "")
	if keys := w.objects(prefix); len(keys) != 2 {
		t.Fatalf("stored %v", keys)
	}

	expect(t, w.do(http.MethodDelete, filePath(h, item), jana, ""), http.StatusNoContent, "")
	if len(w.rows(h, item)) != 0 || !slices.Equal(w.jobs(h, item), []string{"purge"}) {
		t.Fatalf("after the delete: rows %v, jobs %v", w.rows(h, item), w.jobs(h, item))
	}
	w.files.Drain(t.Context(), h)
	if keys := w.objects(prefix); len(keys) != 0 || len(w.jobs(h, item)) != 0 {
		t.Fatalf("after the purge: %v, jobs %v", keys, w.jobs(h, item))
	}
}

// A worker's transaction holds the original, as it does to record what it derived, and has recorded
// a variant; the entity's delete waits for it, and takes the variant with the rest, rather than
// leaving a row no original, link or purge reaches, billed for good.
func TestADeleteBesideAWorkerTakesWhatItRecorded(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, w.upload(h, jana, "a.png", picture(t, 400, 400), map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	scoped := tenant.Assume(t.Context(), testsupport.Open(t).Pool(t, db.RoleApp), h, uuid.Nil, "")

	removed := make(chan error, 1)
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		if _, err := tx.Exec(scoped, `
			SELECT FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original' FOR UPDATE`,
			h, probe.Name, item); err != nil {
			return err
		}
		if _, err := tx.Exec(scoped, `
			INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, owner_id)
			VALUES ($1, $2, $3, 'preview', 'image/jpeg', 10, $4, $5)`,
			h, probe.Name, item, make([]byte, 32), jana); err != nil {
			return err
		}
		go func() {
			removed <- tenant.InWriteTx(scoped, func(tx pgx.Tx) error { return files.Remove(scoped, tx, probe.Name, item) })
		}()
		waitForALock(t, w)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := <-removed; err != nil {
		t.Fatal(err)
	}
	if rows := w.rows(h, item); len(rows) != 0 {
		t.Fatalf("after the delete beside a worker: %+v", rows)
	}
	if jobs := w.jobs(h, item); !slices.Equal(jobs, []string{"purge"}) {
		t.Fatalf("jobs %v", jobs)
	}
}

// A job that fails for good beside the delete of its entity waits for the delete, and the delete for
// nothing: the worker takes the original's row before the job's, the order the delete takes them in.
// The other way round, the worker held the job the delete removes while it waited for the original
// the delete held, and PostgreSQL broke the deadlock by aborting one of them, the member's delete or
// the worker's settling.
func TestAJobFailingBesideADeleteWaitsForIt(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	item := idgen.New()
	// An original whose bytes the store does not hold: its job fails for good.
	w.exec(`INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, variants)
		VALUES ($1, $2, $3, 'original', 'image/png', 10, $4, 'pending')`, h, probe.Name, item, make([]byte, 32))
	w.exec("INSERT INTO file_jobs (household_id, kind, module, entity_id) VALUES ($1, 'variants', $2, $3)", h, probe.Name, item)
	scoped := tenant.Assume(t.Context(), testsupport.Open(t).Pool(t, db.RoleApp), h, uuid.Nil, "")

	drained := make(chan struct{})
	if err := tenant.InWriteTx(scoped, func(tx pgx.Tx) error {
		// The delete's first step (Remove), taken before the worker settles the job.
		if _, err := tx.Exec(scoped, `
			SELECT FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original' FOR UPDATE`,
			h, probe.Name, item); err != nil {
			return err
		}
		go func() {
			defer close(drained)
			w.files.Drain(t.Context(), h)
		}()
		waitForALock(t, w)
		return files.Remove(scoped, tx, probe.Name, item)
	}); err != nil {
		t.Fatalf("the delete beside a job failing for good: %v", err)
	}
	<-drained
	if logged := w.workLog.String(); strings.Contains(logged, "files: settle a job") {
		t.Fatalf("the worker could not settle the job beside the delete: %s", logged)
	}
	if rows, jobs := w.rows(h, item), w.jobs(h, item); len(rows) != 0 || len(jobs) != 0 {
		t.Fatalf("after the delete and the drain: rows %+v, jobs %v", rows, jobs)
	}
}

// The sweep and the purge read which objects a household's rows record as the request role, with no
// caller, and delete what they do not find (files.Service.Sweep): a restrictive policy on files that
// reached that role, a private file's owner's as ADR 0005 writes one for a module's table, would hide
// rows from them, and the next sweep would delete the bytes of every file it hid. So files takes
// none, and the question this asks of the schema finds one that is made.
func TestNoPolicyHidesAFilesRowFromTheSweep(t *testing.T) {
	admin := testsupport.Open(t).Pool(t, "")
	const narrowing = `
		SELECT p.polname FROM pg_policy p
		WHERE p.polrelid = 'public.files'::regclass AND NOT p.polpermissive
		  AND (0 = ANY (p.polroles) OR (SELECT r.oid FROM pg_roles r WHERE r.rolname = $1) = ANY (p.polroles))`
	names := func(q interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
	},
	) []string {
		t.Helper()
		rows, err := q.Query(t.Context(), narrowing, db.RoleApp)
		if err != nil {
			t.Fatal(err)
		}
		out, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got := names(admin); len(got) != 0 {
		t.Fatalf("files has restrictive policies %v, which would hide rows from the sweep and have it delete their bytes", got)
	}

	tx, err := admin.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(t.Context(),
		"CREATE POLICY own_files ON files AS RESTRICTIVE FOR SELECT TO "+db.RoleApp+" USING (NOT private OR owner_id = app_user_id())"); err != nil {
		t.Fatal(err)
	}
	if got := names(tx); !slices.Equal(got, []string{"own_files"}) {
		t.Fatalf("a restrictive policy made on files was found as %v", got)
	}
}

// Bytes no row records, which an upload whose mutation failed leaves, are swept once they are a day
// old, and nothing a row records is.
func TestTheSweepRemovesWhatNoRowRecords(t *testing.T) {
	clk := &clock{t: time.Now()}
	w := newFileWorld(t, func(c *files.Config) { c.Now = clk.now })
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	kept := idgen.New()
	expect(t, w.upload(h, jana, "kept.txt", []byte("kept"), map[string]string{"id": kept.String()}), http.StatusCreated, "")
	orphan := files.Key(h, probe.Name, idgen.New(), files.Original)
	if err := w.files.Store().PutOnce(t.Context(), orphan, bytes.NewReader([]byte("left")), 4,
		objectstore.Object{ContentType: "text/plain", SHA256: sha256.Sum256([]byte("left"))}); err != nil {
		t.Fatal(err)
	}

	if n, err := w.files.Sweep(t.Context(), h); err != nil || n != 0 {
		t.Fatalf("a young orphan swept: %d, %v", n, err)
	}
	clk.advance(files.SweepGrace + time.Hour)
	if n, err := w.files.Sweep(t.Context(), h); err != nil || n != 1 {
		t.Fatalf("swept %d, %v", n, err)
	}
	if keys := w.objects("h/" + h.String() + "/"); !slices.Equal(keys, []string{files.Key(h, probe.Name, kept, files.Original)}) {
		t.Fatalf("left %v", keys)
	}

	// Bytes a failed upload left a day ago, sent again for the same entity: the retry finds them
	// stored, records them, and the sweep keeps them.
	retried := idgen.New()
	content := []byte("sent twice")
	if err := w.files.Store().PutOnce(t.Context(), files.Key(h, probe.Name, retried, files.Original), bytes.NewReader(content),
		int64(len(content)), objectstore.Object{ContentType: "text/plain; charset=utf-8", SHA256: sha256.Sum256(content)}); err != nil {
		t.Fatal(err)
	}
	clk.advance(files.SweepGrace + time.Hour)
	expect(t, w.upload(h, jana, "retried.txt", content, map[string]string{"id": retried.String()}), http.StatusCreated, "")
	if n, err := w.files.Sweep(t.Context(), h); err != nil || n != 0 {
		t.Fatalf("a retry's bytes swept: %d, %v", n, err)
	}
	if r, ok := w.rows(h, retried)[files.Original]; !ok || r.size != int64(len(content)) {
		t.Fatalf("the retry's row %+v", w.rows(h, retried))
	}
	if info, err := w.files.Store().Head(t.Context(), files.Key(h, probe.Name, retried, files.Original)); err != nil ||
		info.SHA256 != sha256.Sum256(content) {
		t.Fatalf("the retry's bytes: %+v, %v", info, err)
	}

	// The nightly sweep takes every household, as the meter role lists them.
	another := files.Key(h, probe.Name, idgen.New(), files.Original)
	if err := w.files.Store().PutOnce(t.Context(), another, bytes.NewReader([]byte("left")), 4,
		objectstore.Object{ContentType: "text/plain", SHA256: sha256.Sum256([]byte("left"))}); err != nil {
		t.Fatal(err)
	}
	clk.advance(files.SweepGrace + time.Hour)
	if err := w.files.SweepAll(t.Context()); err != nil {
		t.Fatal(err)
	}
	want := []string{files.Key(h, probe.Name, kept, files.Original), files.Key(h, probe.Name, retried, files.Original)}
	slices.Sort(want)
	if keys := w.objects("h/" + h.String() + "/"); !slices.Equal(keys, want) {
		t.Fatalf("after sweeping every household %v, want %v", keys, want)
	}
}

// converter is a stand-in for the converter sidecar: an office document becomes a one-page PDF, and
// a PDF's page a 600 by 800 PNG, unless fail says what it answers instead.
type converter struct {
	mu    sync.Mutex
	fail  int
	calls []string
}

// failWith makes the stand-in answer status, 0 for its conversions.
func (c *converter) failWith(status int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fail = status
}

func (c *converter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	fail := c.fail
	c.calls = append(c.calls, r.URL.Path+"?"+r.URL.RawQuery)
	c.mu.Unlock()
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		return
	}
	if fail != 0 {
		w.WriteHeader(fail)
		return
	}
	switch r.URL.Path {
	case "/pdf":
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = io.WriteString(w, "%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n")
	case "/page":
		img := image.NewNRGBA(image.Rect(0, 0, 600, 800))
		for i := range img.Pix {
			img.Pix[i] = 255
		}
		w.Header().Set("Content-Type", "image/png")
		_ = png.Encode(w, img)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// document is a minimal Word document: an Office Open XML package with a body.
func document(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		"[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
		"word/document.xml":   `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
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
	return buf.Bytes()
}

// An office document's variants come from the converter: its PDF, and the PDF's first page as a
// preview and a thumbnail. A document the converter cannot convert is left download-only at once; a
// converter that fails is tried again later.
func TestAnOfficeDocumentsVariantsComeFromTheConverter(t *testing.T) {
	stand := &converter{}
	srv := httptest.NewServer(stand)
	defer srv.Close()
	client, err := convert.New(srv.URL, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	w := newFileWorld(t, func(c *files.Config) { c.Convert = client })
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)

	item := idgen.New()
	expect(t, w.upload(h, jana, "Smlouva.docx", document(t), map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	rows := w.rows(h, item)
	if *rows[files.Original].variants != "ready" || rows[files.PDF].contentType != "application/pdf" ||
		rows[files.Preview].contentType != "image/jpeg" || rows[files.Thumbnail].contentType != "image/jpeg" {
		t.Fatalf("rows %+v", rows)
	}
	if !slices.Equal(stand.calls, []string{"/pdf?ext=docx", "/page?side=1600"}) {
		t.Fatalf("converter calls %v", stand.calls)
	}
	l := w.link(h, item, jana, files.PDF)
	if l.ContentType != "application/pdf" || l.Disposition != "inline" {
		t.Fatalf("the PDF's link %+v", l)
	}
	if cd := fetchLink(t, l.URL).header.Get("Content-Disposition"); !strings.Contains(cd, "Smlouva.pdf") {
		t.Errorf("the PDF is not named after the document: %q", cd)
	}

	stand.failWith(http.StatusUnprocessableEntity)
	unconvertible := idgen.New()
	expect(t, w.upload(h, jana, "broken.docx", document(t), map[string]string{"id": unconvertible.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	if rows := w.rows(h, unconvertible); *rows[files.Original].variants != "failed" || len(rows) != 1 || len(w.jobs(h, unconvertible)) != 0 {
		t.Fatalf("an unconvertible document: %+v, jobs %v", rows, w.jobs(h, unconvertible))
	}

	stand.failWith(http.StatusServiceUnavailable)
	later := idgen.New()
	expect(t, w.upload(h, jana, "later.docx", document(t), map[string]string{"id": later.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	var attempts int
	var runAt time.Time
	if err := w.admin.QueryRow(t.Context(), "SELECT attempts, run_at FROM file_jobs WHERE household_id = $1 AND entity_id = $2",
		h, later).Scan(&attempts, &runAt); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || !runAt.After(time.Now().Add(30*time.Second)) || *w.rows(h, later)[files.Original].variants != "pending" {
		t.Fatalf("a converter that failed: attempts %d, runs at %s", attempts, runAt)
	}
}

// A job runs for its lease at most: one whose store stops answering fails, and is tried again later,
// rather than holding its worker for as long as the process lives.
func TestAJobPastItsLeaseIsTriedAgain(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, w.upload(h, jana, "a.png", picture(t, 100, 100), map[string]string{"id": item.String()}), http.StatusCreated, "")

	stalled := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	t.Cleanup(stalled.Close)
	endpoint, err := url.Parse(stalled.URL)
	if err != nil {
		t.Fatal(err)
	}
	store, err := objectstore.New(objectstore.Config{
		Location: objectstore.Location{Endpoint: endpoint, Bucket: "stalled", AccessKey: "tester", Secret: "stalled"},
		Attempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	stuck := apptest.Files(t, testsupport.Open(t).Pool(t, db.RoleApp), logging.New(io.Discard, slog.LevelDebug), apptest.Options{},
		func(c *files.Config) { c.Store, c.Lease = store, 500*time.Millisecond })

	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	stuck.Drain(ctx, h)
	if ctx.Err() != nil {
		t.Fatal("a job whose store stopped answering held its worker past its lease")
	}
	var (
		attempts  int
		backedOff bool
	)
	if err := w.admin.QueryRow(t.Context(), `
		SELECT attempts, run_at > now() + interval '30 seconds' FROM file_jobs
		WHERE household_id = $1 AND kind = 'variants' AND entity_id = $2`, h, item).Scan(&attempts, &backedOff); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || !backedOff {
		t.Fatalf("the job was left at attempt %d, backed off %t", attempts, backedOff)
	}
	if v := w.rows(h, item)[files.Original].variants; v == nil || *v != "pending" {
		t.Fatalf("the variants are %v", v)
	}
}

// The workers run the jobs every instance's commits leave: woken by their own, and finding the rest
// through the meter role, which alone reads across households.
func TestTheWorkersRunWhatCommitsLeave(t *testing.T) {
	w := newFileWorld(t, func(c *files.Config) { c.Poll = 50 * time.Millisecond })
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, w.upload(h, jana, "a.png", picture(t, 100, 100), map[string]string{"id": item.String()}), http.StatusCreated, "")

	stop := make(chan struct{})
	ctx, cancel := context.WithCancel(t.Context())
	go func() {
		defer close(stop)
		w.files.Run(ctx)
	}()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if v := w.rows(h, item)[files.Original].variants; v != nil && *v == "ready" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-stop
	if v := w.rows(h, item)[files.Original].variants; v == nil || *v != "ready" {
		t.Fatalf("the workers left the variants %v", v)
	}
}

// The households due take turns: a worker lets a household go once its turn is over, and the others
// found due with it take theirs before it takes more. A household with a backlog, an archive of
// documents each waiting on the converter, would otherwise keep every other household's previews
// waiting behind the whole of it. With one worker and a turn of one job, the household that uploaded
// last has its picture's variants derived before the backlog uploaded first is through.
func TestTheHouseholdsDueTakeTurns(t *testing.T) {
	w := newFileWorld(t, func(c *files.Config) {
		c.Workers, c.Turn, c.Poll = 1, time.Nanosecond, 50*time.Millisecond
	})
	busy, quiet := w.household(true), w.household(true)
	jana, petr := w.member(busy, access.Owner, nil), w.member(quiet, access.Owner, nil)
	var backlog []uuid.UUID
	for range 3 {
		item := idgen.New()
		backlog = append(backlog, item)
		expect(t, w.upload(busy, jana, "a.png", picture(t, 100, 100), map[string]string{"id": item.String()}), http.StatusCreated, "")
	}
	late := idgen.New()
	expect(t, w.upload(quiet, petr, "b.png", picture(t, 100, 100), map[string]string{"id": late.String()}), http.StatusCreated, "")

	stop := make(chan struct{})
	ctx, cancel := context.WithCancel(t.Context())
	go func() {
		defer close(stop)
		w.files.Run(ctx)
	}()
	ready := func() bool {
		for _, item := range backlog {
			if w.variantsOf(busy, item) != "ready" {
				return false
			}
		}
		return w.variantsOf(quiet, late) == "ready"
	}
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline) && !ready(); {
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-stop
	if !ready() {
		t.Fatal("the workers left variants underived")
	}
	// When each was derived: its thumbnail's row is recorded in the transaction that marks its
	// original ready, one job after another with one worker.
	derived := func(household, item uuid.UUID) time.Time {
		var at time.Time
		if err := w.admin.QueryRow(t.Context(), `
			SELECT created_at FROM files WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'thumbnail'`,
			household, probe.Name, item).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	after := 0
	for _, item := range backlog {
		if derived(busy, item).After(derived(quiet, late)) {
			after++
		}
	}
	if after == 0 {
		t.Fatal("the household that uploaded last waited for the whole of the other's backlog")
	}
}

// emptyFrame is a GIF whose logical screen is 10 by 5000 pixels and whose one frame is none of it
// wide: its header is an image's, and its frame decodes to no pixels at all.
func emptyFrame() []byte {
	b := []byte("GIF89a")
	b = binary.LittleEndian.AppendUint16(b, 10)
	b = binary.LittleEndian.AppendUint16(b, 5000)
	b = append(b, 0x80, 0, 0, 0, 0, 0, 255, 255, 255)
	b = append(b, 0x2C, 0, 0, 0, 0, 0, 0)
	b = binary.LittleEndian.AppendUint16(b, 5000)
	return append(b, 0, 2, 1, 0x2C, 0, 0x3B)
}

// An image that decodes to no pixels is kept, and its variants fail for good, leaving it
// download-only: it was scaled by dividing by its width, which took down the process whose worker
// derived it, and after each lease the next instance to claim its job.
func TestAnImageOfNoPixelsIsKeptWithoutVariants(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, w.upload(h, jana, "blank.gif", emptyFrame(), map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	if v := w.variantsOf(h, item); v != "failed" {
		t.Fatalf("the variants of an image of no pixels are %q", v)
	}
	if keys := w.objects(files.Key(h, probe.Name, item, "")); len(keys) != 1 || len(w.jobs(h, item)) != 0 {
		t.Fatalf("kept %v, jobs %v", keys, w.jobs(h, item))
	}
}

// A job claimed more times than it may be tried is given up without running: each claim counts an
// attempt, and one past the last is a job whose workers ended with their process before they could
// settle it, which run again would end the next instance to claim it, one lease after another.
func TestAJobItsWorkersNeverSettledIsGivenUp(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	expect(t, w.upload(h, jana, "a.png", picture(t, 100, 100), map[string]string{"id": item.String()}), http.StatusCreated, "")
	// The worker of its fifth and last attempt died holding it, and its lease has passed.
	w.exec("UPDATE file_jobs SET attempts = 5, run_at = now() - interval '1 second' WHERE household_id = $1 AND entity_id = $2", h, item)

	w.files.Drain(t.Context(), h)
	if v := w.variantsOf(h, item); v != "failed" {
		t.Fatalf("the variants of a job never settled are %q", v)
	}
	if keys := w.objects(files.Key(h, probe.Name, item, "")); len(keys) != 1 || len(w.jobs(h, item)) != 0 {
		t.Fatalf("a job given up derived %v, jobs %v", keys, w.jobs(h, item))
	}
	// Every line a job logs names its household, which the workers, in no request's scope, name
	// themselves (FR-NF5).
	if logged := w.workLog.String(); !strings.Contains(logged, "files: a job failed for good") ||
		!strings.Contains(logged, `"household_id":"`+h.String()+`"`) {
		t.Fatalf("a job given up was not logged with its household: %s", logged)
	}
}

// A purge that fails for good marks no original's variants: none is its own, and one recorded again
// under its entity's id once the delete had committed is another upload's, whose variants its own job
// derived. Marked failed by the purge, that file would stay download-only for good.
func TestAPurgeGivenUpLeavesAnotherUploadsVariants(t *testing.T) {
	w := newFileWorld(t)
	h := w.household(true)
	jana := w.member(h, access.Owner, nil)
	item := idgen.New()
	content := picture(t, 100, 100)
	expect(t, w.upload(h, jana, "a.png", content, map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	expect(t, w.do(http.MethodDelete, filePath(h, item), jana, ""), http.StatusNoContent, "")
	// The purge fails, and waits out its backoff, while the same file is recorded again under the id
	// and its variants are derived.
	w.exec("UPDATE file_jobs SET attempts = 4, run_at = now() + interval '1 hour' WHERE household_id = $1 AND kind = 'purge'", h)
	expect(t, w.upload(h, jana, "a.png", content, map[string]string{"id": item.String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), h)
	if v := w.variantsOf(h, item); v != "ready" {
		t.Fatalf("the variants of the file recorded again are %q", v)
	}
	// Its last attempt, whose worker died holding it: it is given up without running.
	w.exec("UPDATE file_jobs SET attempts = 5, run_at = now() - interval '1 second' WHERE household_id = $1 AND kind = 'purge'", h)

	w.files.Drain(t.Context(), h)
	if jobs := w.jobs(h, item); len(jobs) != 0 {
		t.Fatalf("jobs %v", jobs)
	}
	if v := w.variantsOf(h, item); v != "ready" {
		t.Fatalf("a purge given up marked another upload's variants %q", v)
	}
	if keys := w.objects(files.Key(h, probe.Name, item, "")); len(keys) != 2 {
		t.Fatalf("the file recorded again keeps %v", keys)
	}
}
