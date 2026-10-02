package app_test

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/image/bmp"
	"golang.org/x/image/tiff"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/avatar"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file set users' pictures (plan item 14): a member's own, and a child profile's,
// which its owners set.

// newPictureSite is a site whose pictures are kept on a bucket of the test's own.
func newPictureSite(t *testing.T) (*site, *files.Service) {
	t.Helper()
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	fs := apptest.Files(t, pool, logging.New(io.Discard, slog.LevelDebug), apptest.Options{})
	return newSite(t, apptest.Options{Files: fs}), fs
}

// sendPicture sends content as a picture, by method to path.
func (b *browser) sendPicture(method, path string, content []byte) *httptest.ResponseRecorder {
	b.s.t.Helper()
	body, contentType := form(b.s.t, "photo.png", content, nil)
	return b.send(request{method: method, path: path, body: body, contentType: contentType})
}

// translucent is a w by h PNG that is transparent at its left.
func translucent(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			a := uint8(255)
			if x < w/4 {
				a = 0
			}
			img.Set(x, y, color.NRGBA{R: 10, G: 120, B: 60, A: a})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// pictures lists the objects under user's pictures.
func pictures(t *testing.T, fs *files.Service, user uuid.UUID) []string {
	t.Helper()
	var keys []string
	if err := fs.Store().List(t.Context(), "u/"+user.String()+"/avatar/", func(i objectstore.Info) error {
		keys = append(keys, i.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return keys
}

// fetchPicture fetches a picture's link, and decodes it.
func fetchPicture(t *testing.T, link *string) (string, image.Config, []byte) {
	t.Helper()
	if link == nil {
		t.Fatal("no link to the picture")
	}
	res := fetchLink(t, *link)
	if res.status != http.StatusOK {
		t.Fatalf("the picture's link answered %d", res.status)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(res.body))
	if err != nil {
		t.Fatal(err)
	}
	return res.header.Get("Content-Type"), cfg, res.body
}

// A member's picture is made from what they upload: its centred square, scaled down to 512 pixels a
// side and never enlarged, without its metadata, a PNG when it is transparent. It replaces the one before, whose object goes; PATCH
// /me with null removes it, and nothing else may be set there. It is the account's, under its own
// prefix, and in no household's files (D-107).
func TestAMembersPicture(t *testing.T) {
	s, fs := newPictureSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	me := jana.me()
	if me.AvatarURL != nil {
		t.Fatalf("a new account has a picture: %v", *me.AvatarURL)
	}

	rec := jana.sendPicture(http.MethodPut, "/me/avatar", picture(t, 1200, 800))
	expect(t, rec, http.StatusOK, "")
	var set meBody
	decode(t, rec, &set)
	contentType, cfg, body := fetchPicture(t, set.AvatarURL)
	if contentType != "image/jpeg" || cfg.Width != avatar.Side || cfg.Height != avatar.Side || bytes.Contains(body, []byte("Exif")) {
		t.Fatalf("the picture is %s, %dx%d", contentType, cfg.Width, cfg.Height)
	}
	if again := jana.me(); again.AvatarURL == nil || !strings.Contains(*again.AvatarURL, "/u/"+me.ID.String()+"/avatar/") {
		t.Fatalf("GET /me: %v", again.AvatarURL)
	}
	first := pictures(t, fs, me.ID)
	var n int
	if err := s.admin.QueryRow(t.Context(), "SELECT count(*) FROM files WHERE owner_id = $1", me.ID).Scan(&n); err != nil || n != 0 || len(first) != 1 {
		t.Fatalf("the picture is kept as %v, with %d files rows", first, n)
	}

	rec = jana.sendPicture(http.MethodPut, "/me/avatar", translucent(t, 300, 600))
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &set)
	if contentType, cfg, _ := fetchPicture(t, set.AvatarURL); contentType != "image/png" || cfg.Width != 300 || cfg.Height != 300 {
		t.Fatalf("the transparent picture is %s, %dx%d", contentType, cfg.Width, cfg.Height)
	}
	if now := pictures(t, fs, me.ID); len(now) != 1 || now[0] == first[0] {
		t.Fatalf("after the replacement %v, before %v", now, first)
	}

	rec = jana.patch("/me", `{"avatar_url":"https://example.com/me.png"}`, nil)
	expect(t, rec, http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	if errs := fieldErrorsOf(t, rec); len(errs) != 1 || errs[0].Field != "/avatar_url" {
		t.Fatalf("errors %v", errs)
	}
	rec = jana.patch("/me", `{"avatar_url":null}`, nil)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &set)
	if set.AvatarURL != nil || len(pictures(t, fs, me.ID)) != 0 {
		t.Fatalf("after removing: %v, %v", set.AvatarURL, pictures(t, fs, me.ID))
	}
}

// A picture sent again with its Idempotency-Key is answered as it was the first time, though the
// form was built again, as a client builds it for every attempt, with a boundary of its own, and one
// of another length, as Firefox draws them, which makes the form a few bytes shorter; and only the
// first picture is kept.
func TestAPictureSentAgainWithItsKeyIsKeptOnce(t *testing.T) {
	s, fs := newPictureSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	id := jana.me().ID
	content := picture(t, 64, 64)
	send := func(boundary string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		if err := w.SetBoundary(boundary); err != nil {
			t.Fatal(err)
		}
		part, err := w.CreateFormFile(files.FileField, "photo.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		return jana.send(request{method: http.MethodPut, path: "/me/avatar", body: body.String(), contentType: w.FormDataContentType(),
			header: http.Header{idempotency.Header: {"picture-1"}}})
	}
	first := send("---------------------------1904221783")
	expect(t, first, http.StatusOK, "")
	again := send("---------------------------62734921")
	expect(t, again, http.StatusOK, "")
	if again.Body.String() != first.Body.String() {
		t.Fatalf("the repeat was answered %s, the first %s", again.Body.String(), first.Body.String())
	}
	if keys := pictures(t, fs, id); len(keys) != 1 {
		t.Fatalf("kept %v", keys)
	}
}

// The accounts' prefix is swept as a household's is: a picture no user has, which a replacement whose
// purge failed or an upload whose transaction did not commit left, goes once it is a day old, and a
// picture a user has stays.
func TestAPictureNoUserHasIsSwept(t *testing.T) {
	s, fs := newPictureSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	id := jana.me().ID
	expect(t, jana.sendPicture(http.MethodPut, "/me/avatar", picture(t, 64, 64)), http.StatusOK, "")
	kept := pictures(t, fs, id)
	left := []byte("left behind")
	if err := fs.Store().PutOnce(t.Context(), avatar.Key(id, idgen.New()), bytes.NewReader(left), int64(len(left)),
		objectstore.Object{ContentType: "image/png", SHA256: sha256.Sum256(left)}); err != nil {
		t.Fatal(err)
	}
	clk := &clock{t: time.Now()}
	avatars, err := avatar.New(fs, logging.New(io.Discard, slog.LevelDebug), clk.now)
	if err != nil {
		t.Fatal(err)
	}
	pool := testsupport.Open(t).Pool(t, db.RoleApp)

	if n, err := avatars.Sweep(t.Context(), pool); err != nil || n != 0 {
		t.Fatalf("a young picture swept: %d, %v", n, err)
	}
	clk.advance(files.SweepGrace + time.Hour)
	if n, err := avatars.Sweep(t.Context(), pool); err != nil || n != 1 {
		t.Fatalf("swept %d, %v", n, err)
	}
	if now := pictures(t, fs, id); len(kept) != 1 || !slices.Equal(now, kept) {
		t.Fatalf("left %v, kept %v", now, kept)
	}
}

// A picture written again, as the store's client sends again a write whose answer was lost, finds its
// own bytes at its key, which is the picture's alone: the second write is the first, not an outage,
// and the picture is kept once. Other bytes at its key are no write of its own, and are the store's
// failure still.
func TestAPictureWrittenAgainIsKeptOnce(t *testing.T) {
	log := logging.New(io.Discard, slog.LevelDebug)
	fs := apptest.Files(t, testsupport.Open(t).Pool(t, db.RoleApp), log, apptest.Options{})
	avatars, err := avatar.New(fs, log, nil)
	if err != nil {
		t.Fatal(err)
	}
	body, contentType := form(t, "photo.png", picture(t, 64, 64), nil)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/v1/me/avatar", strings.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	p, err := avatars.Upload(httptest.NewRecorder(), req)
	if err != nil {
		t.Fatal(err)
	}

	user := idgen.New()
	for attempt := range 2 {
		if err := avatars.Put(t.Context(), user, p); err != nil {
			t.Fatalf("write %d of the picture: %v", attempt+1, err)
		}
	}
	if keys := pictures(t, fs, user); len(keys) != 1 || keys[0] != avatar.Key(user, p.ID) {
		t.Fatalf("kept %v", keys)
	}

	other := idgen.New()
	left := []byte("not the picture")
	if err := fs.Store().PutOnce(t.Context(), avatar.Key(other, p.ID), bytes.NewReader(left), int64(len(left)),
		objectstore.Object{ContentType: "image/png", SHA256: sha256.Sum256(left)}); err != nil {
		t.Fatal(err)
	}
	var refused *problem.Problem
	if err := avatars.Put(t.Context(), other, p); !errors.As(err, &refused) || refused.Code != problem.CodeStorageUnavailable {
		t.Fatalf("a picture over other bytes: %v", err)
	}
}

// A picture is refused as an upload is: 415 for what is not an image this server reads, 413 for one
// over 20 MB, known from the body's length before it is read, and 422 for an image that does not
// decode. None is kept.
func TestAPictureIsRefused(t *testing.T) {
	s, fs := newPictureSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	id := jana.me().ID

	expect(t, jana.sendPicture(http.MethodPut, "/me/avatar", []byte("%PDF-1.7\n%%EOF\n")), http.StatusUnsupportedMediaType,
		problem.CodeUnsupportedMediaType)
	// A BMP and a TIFF are images this server decodes, to preview a file, and no picture's: the
	// contract takes a JPEG, a PNG, a GIF or a WebP.
	img := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	var bitmap, scan bytes.Buffer
	if err := bmp.Encode(&bitmap, img); err != nil {
		t.Fatal(err)
	}
	if err := tiff.Encode(&scan, img, nil); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{"bmp": bitmap.Bytes(), "tiff": scan.Bytes()} {
		if rec := jana.sendPicture(http.MethodPut, "/me/avatar", content); rec.Code != http.StatusUnsupportedMediaType {
			t.Errorf("a %s picture: %d %s", name, rec.Code, rec.Body.String())
		}
	}

	body, contentType := form(t, "photo.png", picture(t, 10, 10), nil)
	req := request{method: http.MethodPut, path: "/me/avatar", body: body, contentType: contentType}
	req.length = avatar.MaxBytes + 1<<20
	large := jana.send(req)
	expect(t, large, http.StatusRequestEntityTooLarge, problem.CodePayloadTooLarge)

	broken := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	rec := jana.sendPicture(http.MethodPut, "/me/avatar", broken)
	expect(t, rec, http.StatusUnprocessableEntity, problem.CodeValidationFailed)
	if errs := fieldErrorsOf(t, rec); len(errs) != 1 || errs[0].Field != "/file" {
		t.Fatalf("errors %v", errs)
	}
	if keys := pictures(t, fs, id); len(keys) != 0 || jana.me().AvatarURL != nil {
		t.Fatalf("a refused picture was kept: %v", keys)
	}
}

// A child profile's picture is set and removed by its household's owners: the profile answers with
// it, its version moving and the change recorded; the member list and the profile picker, which the
// household code opens, link to it. A member who is not an owner may not set it, and a member who is
// not a child profile has no picture an owner sets. In grace, which uploads nothing, it is refused.
func TestAChildProfilesPicture(t *testing.T) {
	s, _ := newPictureSite(t)
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	adam := jana.child(h.ID, "Adam", "4821", nil)
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	path := householdPath(h.ID, "/children/"+adam.UserID.String()+"/avatar")

	rec := jana.sendPicture(http.MethodPut, path, picture(t, 640, 480))
	expect(t, rec, http.StatusOK, "")
	var set memberDoc
	decode(t, rec, &set)
	if set.AvatarURL == nil || set.Version != adam.Version+1 || rec.Header().Get("ETag") == "" {
		t.Fatalf("the profile %+v, ETag %q", set, rec.Header().Get("ETag"))
	}
	// Its centred square, 480 a side: a picture is never enlarged.
	if _, cfg, _ := fetchPicture(t, set.AvatarURL); cfg.Width != 480 || cfg.Height != 480 {
		t.Fatalf("the child's picture is %dx%d", cfg.Width, cfg.Height)
	}
	if listed := jana.members(h.ID)["Adam"]; listed.AvatarURL == nil {
		t.Fatal("the member list shows no picture for the child")
	}
	rec = s.phone("Adam's tablet").profiles(h.JoinCode)
	expect(t, rec, http.StatusOK, "")
	var picker struct {
		Items []struct {
			ID        uuid.UUID `json:"id"`
			AvatarURL *string   `json:"avatar_url"`
		} `json:"items"`
	}
	decode(t, rec, &picker)
	if len(picker.Items) != 1 || picker.Items[0].ID != adam.UserID || picker.Items[0].AvatarURL == nil {
		t.Fatalf("the picker %+v", picker)
	}

	expect(t, petr.sendPicture(http.MethodPut, path, picture(t, 64, 64)), http.StatusForbidden, problem.CodeForbidden)
	expect(t, jana.sendPicture(http.MethodPut, householdPath(h.ID, "/children/"+petrID.String()+"/avatar"), picture(t, 64, 64)),
		http.StatusNotFound, problem.CodeNotFound)

	rec = jana.delete(path)
	expect(t, rec, http.StatusOK, "")
	var cleared memberDoc
	decode(t, rec, &cleared)
	if cleared.AvatarURL != nil || cleared.Version != set.Version+1 {
		t.Fatalf("after removing %+v", cleared)
	}
	rec = jana.delete(path)
	expect(t, rec, http.StatusOK, "")
	decode(t, rec, &cleared)
	if cleared.Version != set.Version+1 {
		t.Fatalf("removing nothing moved the version: %+v", cleared)
	}

	var changes []string
	arrange(t, s, func(tx pgx.Tx) {
		rows, err := tx.Query(t.Context(), `
			SELECT summary_args->>'change' FROM audit_events
			WHERE household_id = $1 AND action = 'child.avatar' ORDER BY occurred_at, id`, h.ID)
		if err != nil {
			t.Fatal(err)
		}
		if changes, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			t.Fatal(err)
		}
	})
	if strings.Join(changes, ",") != "set,cleared" {
		t.Fatalf("recorded %v", changes)
	}

	// A picture is an upload, which grace refuses as it refuses every other (PRD 04 §3).
	if _, err := s.admin.Exec(t.Context(), `UPDATE households SET billing_state = 'grace', grace_ends_at = now() + interval '14 days'
		WHERE id = $1`, h.ID); err != nil {
		t.Fatal(err)
	}
	rec = jana.sendPicture(http.MethodPut, path, picture(t, 64, 64))
	expect(t, rec, http.StatusPaymentRequired, problem.CodeEntitlementReadOnly)
	if r := refusalOf(t, rec); r.State != "grace" {
		t.Fatalf("grace's refusal: %+v", r)
	}
}
