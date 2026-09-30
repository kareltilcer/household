package app_test

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/app/testdata/probe"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file take the daily usage sample (FR-ST2) and read the storage picture (FR-ST4,
// FR-HA14).

// sampleRow is a household's sample of a day, and its split, as the administrator reads them.
type sampleRow struct {
	stored, derived, objects int64
	modules                  map[string][4]int64
	members                  map[uuid.UUID][2]int64
}

func (w *fileWorld) sample(household uuid.UUID, day time.Time) (sampleRow, bool) {
	w.t.Helper()
	ctx := w.t.Context()
	s := sampleRow{modules: map[string][4]int64{}, members: map[uuid.UUID][2]int64{}}
	err := w.admin.QueryRow(ctx, `
		SELECT stored_bytes, derived_bytes, object_count FROM usage_samples WHERE household_id = $1 AND sampled_on = $2`,
		household, day).Scan(&s.stored, &s.derived, &s.objects)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, false
	}
	if err != nil {
		w.t.Fatal(err)
	}
	rows, err := w.admin.Query(ctx, `
		SELECT module, stored_bytes, derived_bytes, object_count, row_count FROM usage_sample_modules
		WHERE household_id = $1 AND sampled_on = $2`, household, day)
	if err != nil {
		w.t.Fatal(err)
	}
	var (
		name string
		m    [4]int64
	)
	if _, err := pgx.ForEachRow(rows, []any{&name, &m[0], &m[1], &m[2], &m[3]}, func() error {
		s.modules[name] = m
		return nil
	}); err != nil {
		w.t.Fatal(err)
	}
	rows, err = w.admin.Query(ctx, `
		SELECT user_id, stored_bytes, object_count FROM usage_sample_members WHERE household_id = $1 AND sampled_on = $2`, household, day)
	if err != nil {
		w.t.Fatal(err)
	}
	var (
		user uuid.UUID
		u    [2]int64
	)
	if _, err := pgx.ForEachRow(rows, []any{&user, &u[0], &u[1]}, func() error {
		s.members[user] = u
		return nil
	}); err != nil {
		w.t.Fatal(err)
	}
	return s, true
}

// sum returns what the files rows matching where hold, as the administrator sums them: their bytes
// and their count.
func (w *fileWorld) sum(where string, args ...any) (int64, int64) {
	w.t.Helper()
	var bytes, n int64
	if err := w.admin.QueryRow(w.t.Context(), "SELECT coalesce(sum(byte_size), 0)::bigint, count(*) FROM files WHERE "+where, args...).
		Scan(&bytes, &n); err != nil {
		w.t.Fatal(err)
	}
	return bytes, n
}

// sampler samples as the server does: measuring as the meter role, writing as the request role.
func (w *fileWorld) sampler(now time.Time) *storage.Sampler {
	w.t.Helper()
	registry, err := module.NewRegistry(probe.Module{})
	if err != nil {
		w.t.Fatal(err)
	}
	d := testsupport.Open(w.t)
	return &storage.Sampler{
		Meter: d.Pool(w.t, db.RoleMeter), Pool: d.Pool(w.t, db.RoleApp), Modules: registry,
		Log: logging.New(io.Discard, slog.LevelDebug), Now: func() time.Time { return now },
	}
}

// The daily sample records what each household keeps, derived variants included, by module and by
// member, with its objects and the rows of each module's tables (FR-ST2, FR-ST3): a second sample the
// same day replaces the first, and a household that keeps nothing is sampled at nothing.
func TestTheSampleBreaksDownByModuleAndMember(t *testing.T) {
	w := newFileWorld(t)
	a, b, empty := w.household(true), w.household(true), w.household(true)
	jana := w.member(a, access.Owner, nil)
	petr := w.member(a, access.Member, level(access.Contribute))
	milos := w.member(b, access.Owner, nil)
	w.member(empty, access.Owner, nil)

	expect(t, w.upload(a, jana, "a.txt", make([]byte, 100), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	expect(t, w.upload(a, jana, "b.txt", make([]byte, 50), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	expect(t, w.upload(a, petr, "c.png", picture(t, 60, 60), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	expect(t, w.upload(b, milos, "d.txt", make([]byte, 30), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	w.files.Drain(t.Context(), a)
	w.item(a)
	// A document of Jana's, which another module keeps, with its thumbnail.
	document := idgen.New()
	w.exec(`INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, owner_id, variants)
		VALUES ($1, 'documents', $2, 'original', 'application/pdf', 1000, decode(repeat('ab', 32), 'hex'), $3, 'ready'),
		       ($1, 'documents', $2, 'thumbnail', 'image/jpeg', 100, decode(repeat('cd', 32), 'hex'), $3, NULL)`, a, document, jana)

	now := time.Date(2026, 9, 30, 1, 30, 0, 0, time.UTC)
	day := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	if _, err := w.sampler(now).Sample(t.Context()); err != nil {
		t.Fatal(err)
	}

	got, ok := w.sample(a, day)
	if !ok {
		t.Fatal("household A was not sampled")
	}
	stored, objects := w.sum("household_id = $1", a)
	derived, _ := w.sum("household_id = $1 AND variant <> 'original'", a)
	probeStored, probeObjects := w.sum("household_id = $1 AND module = 'probe'", a)
	probeDerived, _ := w.sum("household_id = $1 AND module = 'probe' AND variant <> 'original'", a)
	janas, janaObjects := w.sum("household_id = $1 AND owner_id = $2", a, jana)
	petrs, petrObjects := w.sum("household_id = $1 AND owner_id = $2", a, petr)
	if got.stored != stored || got.derived != derived || got.objects != objects || derived <= 100 {
		t.Errorf("A: %+v, want %d stored, %d derived, %d objects", got, stored, derived, objects)
	}
	if want := [4]int64{probeStored, probeDerived, probeObjects, 4}; got.modules["probe"] != want {
		t.Errorf("A's probe: %v, want %v", got.modules["probe"], want)
	}
	if want := [4]int64{1100, 100, 2, 0}; got.modules["documents"] != want {
		t.Errorf("A's documents: %v, want %v", got.modules["documents"], want)
	}
	if len(got.members) != 2 || got.members[jana] != [2]int64{janas, janaObjects} || got.members[petr] != [2]int64{petrs, petrObjects} {
		t.Errorf("A's members: %v", got.members)
	}
	if got, ok := w.sample(b, day); !ok || got.stored != 30 || got.modules["probe"] != [4]int64{30, 0, 1, 1} ||
		got.members[milos] != [2]int64{30, 1} {
		t.Errorf("B: %+v, %v", got, ok)
	}
	if got, ok := w.sample(empty, day); !ok || got.stored != 0 || got.objects != 0 || len(got.modules) != 0 || len(got.members) != 0 {
		t.Errorf("a household that keeps nothing: %+v, %v", got, ok)
	}

	// The same counts, live, in the household's own context: what fair use compares with before a
	// write (PRD 04 §5).
	registry, err := module.NewRegistry(probe.Module{})
	if err != nil {
		t.Fatal(err)
	}
	live, err := storage.Count(tenant.Assume(t.Context(), testsupport.Open(t).Pool(t, db.RoleApp), a, uuid.Nil, access.Owner), registry)
	if err != nil {
		t.Fatal(err)
	}
	if live.Objects != objects || len(live.Rows) != 1 || live.Rows["probe"] != 4 {
		t.Errorf("live counts %+v, want %d objects and 4 probe rows", live, objects)
	}

	// Sampled again the same day, after another upload: the day's sample is replaced.
	expect(t, w.upload(b, milos, "e.txt", make([]byte, 20), map[string]string{"id": idgen.New().String()}), http.StatusCreated, "")
	if _, err := w.sampler(now.Add(time.Hour)).Sample(t.Context()); err != nil {
		t.Fatal(err)
	}
	var samples int
	if err := w.admin.QueryRow(t.Context(), "SELECT count(*) FROM usage_samples WHERE household_id = $1", b).Scan(&samples); err != nil {
		t.Fatal(err)
	}
	if got, _ := w.sample(b, day); samples != 1 || got.stored != 50 || got.modules["probe"] != [4]int64{50, 0, 2, 2} {
		t.Errorf("B sampled again: %d samples, %+v", samples, got)
	}
}

// reportDoc is the contract's StorageReport, as a client reads it.
type reportDoc struct {
	TotalBytes    int64 `json:"total_bytes"`
	IncludedBytes int64 `json:"included_bytes"`
	ObjectCount   int64 `json:"object_count"`
	ByModule      []struct {
		Module       string `json:"module"`
		Bytes        int64  `json:"bytes"`
		DerivedBytes int64  `json:"derived_bytes"`
		ObjectCount  int64  `json:"object_count"`
	} `json:"by_module"`
	ByMember []struct {
		User struct {
			UserID         uuid.UUID `json:"user_id"`
			Label          string    `json:"label"`
			IsFormerMember bool      `json:"is_former_member"`
		} `json:"user"`
		Bytes int64 `json:"bytes"`
	} `json:"by_member"`
	Largest []struct {
		Module           string    `json:"module"`
		EntityID         uuid.UUID `json:"entity_id"`
		Label            string    `json:"label"`
		Bytes            int64     `json:"bytes"`
		RecoverableBytes int64     `json:"recoverable_bytes"`
	} `json:"largest"`
	Trend []struct {
		Date  string `json:"date"`
		Bytes int64  `json:"bytes"`
	} `json:"trend"`
}

func (b *browser) storage(h uuid.UUID) reportDoc {
	b.s.t.Helper()
	rec := b.get(householdPath(h, "/storage"))
	expect(b.s.t, rec, http.StatusOK, "")
	var r reportDoc
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		b.s.t.Fatal(err)
	}
	return r
}

// The storage picture is what the household keeps, against the contract's StorageReport: its totals,
// split by module with the derived overhead apart, and by member, a former one among them; its
// largest items, labelled by their files' names, with what deleting each recovers; and its samples.
// It is read with view on the household settings, and is absent for anyone else. The largest items
// leave out what the reader could not open: another member's private item, and anything in a module
// they cannot see (D-108).
func TestTheStoragePicture(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi").ID
	petr, petrID := s.joined(jana, h, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	klara, _ := s.joined(jana, h, "Klára", s.a("klara@tilcerovi.cz"), "member", map[string]string{"admin": "none"})
	janaID := jana.me().ID
	former := idgen.New()

	ids := map[string]uuid.UUID{}
	arrange(t, s, func(tx pgx.Tx) {
		exec(t, tx, "INSERT INTO users (id, display_name) VALUES ($1, 'Miloš')", former)
		for _, f := range []struct {
			name, module, filename string
			owner                  uuid.UUID
			private                bool
			bytes, thumbnail       int64
		}{
			{"janas shared", "documents", "Smlouva.pdf", janaID, false, 5000, 300},
			{"janas private", "documents", "Deník.pdf", janaID, true, 3000, 0},
			{"petrs private", "documents", "Petr.pdf", petrID, true, 4000, 0},
			{"petrs note", "notes", "note.png", petrID, false, 2000, 0},
			{"janas finance", "finance", "výpis.csv", janaID, false, 1000, 0},
			{"a former members", "chat", "video.mp4", former, false, 7000, 0},
		} {
			id := idgen.New()
			ids[f.name] = id
			exec(t, tx, `INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, filename, owner_id, private, variants)
				VALUES ($1, $2, $3, 'original', 'application/pdf', $4, decode(repeat('ab', 32), 'hex'), $5, $6, $7, 'none')`,
				h, f.module, id, f.bytes, f.filename, f.owner, f.private)
			if f.thumbnail > 0 {
				exec(t, tx, `INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, owner_id, private)
					VALUES ($1, $2, $3, 'thumbnail', 'image/jpeg', $4, decode(repeat('cd', 32), 'hex'), $5, $6)`,
					h, f.module, id, f.thumbnail, f.owner, f.private)
			}
		}
		today := time.Now().UTC()
		for i, bytes := range []int64{9000, 22300} {
			exec(t, tx, `INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count)
				VALUES ($1, $2, now(), $3, 0, 1)`, h, today.AddDate(0, 0, i-1).Format(time.DateOnly), bytes)
		}
		exec(t, tx, `INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count)
			VALUES ($1, $2, now(), 1, 0, 1)`, h, today.AddDate(0, 0, -storage.TrendDays).Format(time.DateOnly))
	})

	r := jana.storage(h)
	if r.TotalBytes != 22300 || r.ObjectCount != 7 || r.IncludedBytes != storage.Default.Base {
		t.Fatalf("totals %+v", r)
	}
	var modules []string
	for _, m := range r.ByModule {
		modules = append(modules, m.Module)
	}
	if !slices.Equal(modules, []string{"documents", "chat", "notes", "finance"}) || r.ByModule[0].Bytes != 12000 ||
		r.ByModule[0].DerivedBytes != 300 || r.ByModule[0].ObjectCount != 4 {
		t.Fatalf("by module %+v", r.ByModule)
	}
	if len(r.ByMember) != 3 || r.ByMember[0].User.UserID != janaID || r.ByMember[0].Bytes != 9300 || r.ByMember[0].User.Label != "Jana" ||
		r.ByMember[1].User.UserID != former || !r.ByMember[1].User.IsFormerMember || r.ByMember[1].User.Label != "Miloš" ||
		r.ByMember[2].User.UserID != petrID || r.ByMember[2].User.IsFormerMember {
		t.Fatalf("by member %+v", r.ByMember)
	}
	largest := func(r reportDoc) []string {
		var out []string
		for _, it := range r.Largest {
			for name, id := range ids {
				if id == it.EntityID {
					out = append(out, name)
				}
			}
		}
		return out
	}
	if got := largest(r); !slices.Equal(got, []string{"a former members", "janas shared", "janas private", "petrs note", "janas finance"}) {
		t.Fatalf("Jana's largest %v", got)
	}
	if it := r.Largest[1]; it.Label != "Smlouva.pdf" || it.Bytes != 5000 || it.RecoverableBytes != 5300 || it.Module != "documents" {
		t.Fatalf("Jana's shared document %+v", it)
	}
	if len(r.Trend) != 2 || r.Trend[0].Bytes != 9000 || r.Trend[1].Bytes != 22300 || r.Trend[1].Date != time.Now().UTC().Format(time.DateOnly) {
		t.Fatalf("trend %+v", r.Trend)
	}

	// Petr, who holds none on Finance, sees his own private item and not Jana's, and nothing of
	// Finance's.
	if got := largest(petr.storage(h)); !slices.Equal(got, []string{"a former members", "janas shared", "petrs private", "petrs note"}) {
		t.Fatalf("Petr's largest %v", got)
	}
	expect(t, klara.get(householdPath(h, "/storage")), http.StatusNotFound, problem.CodeNotFound)
}
