package app_test

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/app/testdata/probe"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/privacy"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The tests in this file prove export, erasure, diagnostics and consent (plan item 20) through the
// server's own routes and jobs, against the committed contract. A module's part of them goes through
// the probe, which keeps an item with a file the way a module keeps a document, and holds some of them
// privately the way a module holds a private root.

// quietProbe is the probe with no routes of its own, which the committed contract does not declare:
// its rows are written here as the administrator writes them, and its export and erasure are the
// probe's.
type quietProbe struct{ probe.Module }

func (quietProbe) RegisterRoutes(chi.Router) {}

// privacySite is a site that serves the probe's module, keeps files in a bucket of its own, and
// runs the household surface's Lost hook as the server does.
type privacySite struct {
	*site
	files *files.Service
	store *objectstore.Store
}

func newPrivacySite(t *testing.T) *privacySite {
	t.Helper()
	pool := testsupport.Open(t).Pool(t, db.RoleApp)
	fs := apptest.Files(t, pool, logging.New(io.Discard, slog.LevelDebug), apptest.Options{})
	registry, err := module.NewRegistry(quietProbe{probe.Module{Files: fs}})
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := registry.WithPlatform(household.Admin())
	if err != nil {
		t.Fatal(err)
	}
	// The hook reads the site's clock, which the site makes.
	var now func() time.Time
	lost := func(ctx context.Context, tx pgx.Tx, loss household.Loss) error {
		return app.Lost(catalog, now)(ctx, tx, loss)
	}
	s := newSite(t, apptest.Options{Files: fs, Hooks: household.Hooks{Lost: lost}}, func(d *app.Deps) { d.Modules = registry })
	now = s.clock.now
	return &privacySite{site: s, files: fs, store: fs.Store()}
}

func (p *privacySite) exec(sql string, args ...any) {
	p.t.Helper()
	if _, err := p.admin.Exec(p.t.Context(), sql, args...); err != nil {
		p.t.Fatalf("%s: %v", sql, err)
	}
}

// probe enables the probe in household h and grants each user their level on it, as the administrator.
func (p *privacySite) probe(h uuid.UUID, levels map[uuid.UUID]string) {
	p.t.Helper()
	p.exec("INSERT INTO module_enablement (id, household_id, module, enabled) VALUES ($1, $2, 'probe', true)", idgen.New(), h)
	for user, level := range levels {
		p.exec("INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, 'probe', $3::access_level)", h, user, level)
	}
}

// item makes a probe item in household h, made by owner, with a file named name holding content,
// private to owner when private says so, and returns its id.
func (p *privacySite) item(h, owner uuid.UUID, private bool, name, content string) uuid.UUID {
	p.t.Helper()
	id := idgen.New()
	body := []byte(content)
	sum := sha256.Sum256(body)
	p.exec("INSERT INTO probe_items (id, household_id, created_by, updated_by) VALUES ($1, $2, $3, $3)", id, h, owner)
	if err := p.store.PutOnce(p.t.Context(), files.Key(h, probe.Name, id, files.Original), bytes.NewReader(body), int64(len(body)),
		objectstore.Object{ContentType: "text/plain", SHA256: sum}); err != nil {
		p.t.Fatal(err)
	}
	p.exec(`
		INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, filename, owner_id, private, variants)
		VALUES ($1, 'probe', $2, 'original', 'text/plain', $3, $4, $5, $6, $7, 'none')`, h, id, len(body), sum[:], name, owner, private)
	return id
}

// work builds the exports that wait, erase runs the nightly erasure, and expire the expiry sweep's
// part. The package's tests share one database, so each finds what another left due beside its own:
// a test asserts what became of its own rows, never how many the run touched.
func (p *privacySite) work() { p.privacy.Work(p.t.Context()) }

func (p *privacySite) erase() privacy.Erased {
	p.t.Helper()
	done, err := p.privacy.Erase(p.t.Context())
	if err != nil {
		p.t.Fatalf("erase: %v", err)
	}
	return done
}

func (p *privacySite) expire() {
	p.t.Helper()
	if _, err := p.privacy.Expire(p.t.Context()); err != nil {
		p.t.Fatalf("expire: %v", err)
	}
}

// objects lists the keys the store holds under prefix.
func (p *privacySite) objects(prefix string) []string {
	p.t.Helper()
	keys := []string{}
	if err := p.store.List(p.t.Context(), prefix, func(o objectstore.Info) error {
		keys = append(keys, o.Key)
		return nil
	}); err != nil {
		p.t.Fatal(err)
	}
	return keys
}

// rowsOf counts household h's rows in every table that names a household, by table, leaving out
// the tables that hold none.
func (p *privacySite) rowsOf(h uuid.UUID) map[string]int {
	p.t.Helper()
	rows, err := p.admin.Query(p.t.Context(), `
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
		  AND EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'household_id' AND NOT a.attisdropped)
		ORDER BY c.relname`)
	if err != nil {
		p.t.Fatal(err)
	}
	tables, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		p.t.Fatal(err)
	}
	out := map[string]int{}
	for _, table := range tables {
		if n := p.count("SELECT count(*) FROM "+pgx.Identifier{table}.Sanitize()+" WHERE household_id = $1", h); n > 0 {
			out[table] = n
		}
	}
	return out
}

// exportDoc is the contract's ExportJob, as a client reads it.
type exportDoc struct {
	ID          uuid.UUID  `json:"id"`
	Scope       string     `json:"scope"`
	HouseholdID *uuid.UUID `json:"household_id"`
	Status      string     `json:"status"`
	ReadyAt     *time.Time `json:"ready_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
	DownloadURL *string    `json:"download_url"`
	SizeBytes   *int64     `json:"size_bytes"`
	Contents    []string   `json:"contents"`
}

func exportOf(t *testing.T, rec interface{ Result() *http.Response }, status int) exportDoc {
	t.Helper()
	res := rec.Result()
	defer func() { _ = res.Body.Close() }()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != status {
		t.Fatalf("status %d, want %d: %s", res.StatusCode, status, body)
	}
	var e exportDoc
	if err := json.Unmarshal(body, &e); err != nil {
		t.Fatal(err)
	}
	return e
}

// archive downloads the archive at url, as a client does with the link it was handed, and returns
// its entries by name and its manifest, having checked the one against the other: every entry but
// the manifest is named there with its length and its digest, and the manifest names nothing else.
func archive(t *testing.T, url string) (map[string]string, privacy.Manifest) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(res.Body)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("the archive's link answered %d, %v", res.StatusCode, err)
	}
	if got := res.Header.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") || !strings.Contains(got, ".zip") {
		t.Errorf("the archive downloads as %q, want an attachment named as a ZIP", got)
	}
	return unpack(t, raw)
}

// stored is the archive of export id as the store holds it, unpacked and checked as archive checks
// one: for a test whose clock has left the store's behind, whose links the store would refuse.
func (p *privacySite) stored(id uuid.UUID) (map[string]string, privacy.Manifest) {
	p.t.Helper()
	var object string
	if err := p.admin.QueryRow(p.t.Context(), "SELECT object FROM exports WHERE id = $1", id).Scan(&object); err != nil {
		p.t.Fatal(err)
	}
	body, _, err := p.store.Get(p.t.Context(), object)
	if err != nil {
		p.t.Fatal(err)
	}
	defer func() { _ = body.Close() }()
	raw, err := io.ReadAll(body)
	if err != nil {
		p.t.Fatal(err)
	}
	return unpack(p.t, raw)
}

// unpack reads raw, an archive, and returns its entries by name and its manifest, checked against
// each other.
func unpack(t *testing.T, raw []byte) (map[string]string, privacy.Manifest) {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]string{}
	for _, f := range zr.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
		if _, twice := entries[f.Name]; twice {
			t.Errorf("the archive holds %s twice", f.Name)
		}
		entries[f.Name] = string(body)
	}
	var m privacy.Manifest
	if err := json.Unmarshal([]byte(entries["manifest.json"]), &m); err != nil {
		t.Fatalf("manifest.json: %v", err)
	}
	if m.SchemaVersion != privacy.SchemaVersion || m.GeneratedAt.IsZero() {
		t.Errorf("the manifest says schema %d taken at %s", m.SchemaVersion, m.GeneratedAt)
	}
	listed := map[string]bool{}
	for _, e := range m.Entries {
		listed[e.Path] = true
		body, ok := entries[e.Path]
		sum := sha256.Sum256([]byte(body))
		if !ok || int64(len(body)) != e.Bytes || hex.EncodeToString(sum[:]) != e.SHA256 {
			t.Errorf("the manifest names %s as %d bytes with digest %s; the archive holds %d bytes (there: %t)", e.Path, e.Bytes, e.SHA256, len(body), ok)
		}
	}
	for name := range entries {
		if name != "manifest.json" && !listed[name] {
			t.Errorf("the archive holds %s, which its manifest does not name", name)
		}
	}
	return entries, m
}

// names are entries' names, sorted.
func names(entries map[string]string) []string {
	out := make([]string, 0, len(entries))
	for name := range entries {
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}

// probeItems are the ids a probe.json names.
func probeItems(t *testing.T, doc string) []uuid.UUID {
	t.Helper()
	var body struct {
		Items []probe.Item `json:"items"`
	}
	if err := json.Unmarshal([]byte(doc), &body); err != nil {
		t.Fatalf("probe.json: %v", err)
	}
	ids := make([]uuid.UUID, 0, len(body.Items))
	for _, item := range body.Items {
		ids = append(ids, item.ID)
	}
	return ids
}

// same reports whether got holds exactly want's ids, in any order.
func same(got []uuid.UUID, want ...uuid.UUID) bool {
	key := func(ids []uuid.UUID) string {
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			out = append(out, id.String())
		}
		slices.Sort(out)
		return strings.Join(out, " ")
	}
	return key(got) == key(want)
}

// An owner's export of the household is a job a worker builds (FR-PR2, FR-HA15): an archive whose
// manifest names every entry, with each module's data, the files under their own names, a readable
// derivative and the activity log; it takes the shared rows and the requester's own private ones,
// never another adult's; it is its requester's alone; and it is downloadable for seven days.
func TestAnOwnersExportOfTheHouseholdMatchesItsManifest(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	shared := p.item(h.ID, janaID, false, "Smlouva ČEZ.txt", "shared")
	own := p.item(h.ID, janaID, true, "deník.txt", "Jana's own")
	theirs := p.item(h.ID, petrID, true, "petr.txt", "Petr's own")
	again := p.item(h.ID, petrID, false, "Smlouva ČEZ.txt", "the same name again")
	path := householdPath(h.ID, "/exports")

	// A household's export is an owner's to ask for.
	expect(t, petr.post(path, ""), http.StatusForbidden, problem.CodeForbidden)
	queued := exportOf(t, jana.post(path, ""), http.StatusAccepted)
	if queued.Status != "queued" || queued.Scope != "household" || queued.HouseholdID == nil || *queued.HouseholdID != h.ID ||
		queued.DownloadURL != nil || len(queued.Contents) != 0 {
		t.Fatalf("queued as %+v", queued)
	}
	// While it waits, asking again answers it.
	if again := exportOf(t, jana.post(path, ""), http.StatusAccepted); again.ID != queued.ID {
		t.Fatalf("a second request queued %s beside %s", again.ID, queued.ID)
	}
	// It is its requester's: no other member lists it or reads it, and it is no export of Jana's own.
	var listed struct {
		Items []exportDoc `json:"items"`
	}
	decode(t, petr.get(path), &listed)
	if len(listed.Items) != 0 {
		t.Fatalf("Petr lists %d of Jana's exports", len(listed.Items))
	}
	expect(t, petr.get(path+"/"+queued.ID.String()), http.StatusNotFound, problem.CodeNotFound)
	expect(t, jana.get("/me/exports/"+queued.ID.String()), http.StatusNotFound, problem.CodeNotFound)

	p.work()
	ready := exportOf(t, jana.get(path+"/"+queued.ID.String()), http.StatusOK)
	if ready.Status != "ready" || ready.DownloadURL == nil || ready.SizeBytes == nil || *ready.SizeBytes == 0 ||
		ready.ExpiresAt == nil || !ready.ExpiresAt.Equal(ready.ReadyAt.Add(7*24*time.Hour)) {
		t.Fatalf("ready as %+v", ready)
	}
	for _, want := range []string{"admin.json", "probe.json", "probe-items.csv", "activity-log.csv", "files/", "manifest.json"} {
		if !slices.Contains(ready.Contents, want) {
			t.Errorf("the job's contents %v lack %s", ready.Contents, want)
		}
	}
	entries, m := archive(t, *ready.DownloadURL)
	if m.Scope != "household" || m.RequestedBy != janaID || len(m.Households) != 1 || m.Households[0].ID != h.ID ||
		m.Households[0].Name != "Tilcerovi" || m.Households[0].Path != "" || !slices.Equal(m.Households[0].Modules, []string{"admin", "probe"}) {
		t.Errorf("the manifest says %+v", m)
	}
	want := []string{
		"activity-log.csv", "admin.json", "files/probe/Smlouva ČEZ (2).txt", "files/probe/Smlouva ČEZ.txt", "files/probe/deník.txt",
		"manifest.json", "probe-items.csv", "probe.json",
	}
	if got := names(entries); !slices.Equal(got, want) {
		t.Fatalf("the archive holds %v, want %v", got, want)
	}
	// The shared items and Jana's own private one; never Petr's.
	if got := probeItems(t, entries["probe.json"]); !same(got, shared, own, again) {
		t.Errorf("probe.json names %v, want %v", got, []uuid.UUID{shared, own, again})
	}
	if strings.Contains(entries["probe-items.csv"], theirs.String()) || entries["files/probe/deník.txt"] != "Jana's own" {
		t.Errorf("the archive holds another adult's private item, or not its requester's own")
	}
	var admin struct {
		Household struct{ Name string } `json:"household"`
		Members   []struct {
			DisplayName string `json:"display_name"`
		} `json:"members"`
		Invitations []json.RawMessage `json:"invitations"`
	}
	if err := json.Unmarshal([]byte(entries["admin.json"]), &admin); err != nil || admin.Household.Name != "Tilcerovi" ||
		len(admin.Members) != 2 || len(admin.Invitations) != 1 || strings.Contains(entries["admin.json"], "token") {
		t.Errorf("admin.json holds %s (%v)", entries["admin.json"], err)
	}
	log := entries["activity-log.csv"]
	if !strings.HasPrefix(log, "occurred_at,actor,module,action,entity_type,entity_id,summary\r\n") ||
		!strings.Contains(log, "Jana,admin,household.create,admin.household_settings,"+h.ID.String()+",Created the household Tilcerovi") ||
		!strings.Contains(log, "Petr,admin,member.join,") {
		t.Errorf("the activity log reads:\n%s", log)
	}
	// Jana is told it is ready, with a link to where it is listed and never to the archive.
	mail := p.outbox.To(p.a("jana@tilcerovi.cz"))
	last := mail[len(mail)-1]
	if !strings.Contains(last.Subject, "export is ready") || !strings.Contains(last.Body, "of Tilcerovi") ||
		!strings.Contains(last.Body, "/households/"+h.ID.String()+"/exports") || strings.Contains(last.Body, "X-Amz") {
		t.Errorf("the email reads %q: %s", last.Subject, last.Body)
	}

	// Seven days on it is expired, whether or not the sweep has run, and the sweep removes its bytes.
	stored := p.objects("u/" + janaID.String() + "/exports/")
	if len(stored) != 1 {
		t.Fatalf("the store holds %v", stored)
	}
	p.clock.advance(7 * 24 * time.Hour)
	if e := exportOf(t, jana.get(path+"/"+queued.ID.String()), http.StatusOK); e.Status != "expired" || e.DownloadURL != nil {
		t.Fatalf("past its seven days it reads %+v", e)
	}
	if p.expire(); len(p.objects("u/"+janaID.String()+"/exports/")) != 0 {
		t.Fatalf("the sweep left %v", p.objects("u/"+janaID.String()+"/exports/"))
	}
	if e := exportOf(t, jana.get(path+"/"+queued.ID.String()), http.StatusOK); e.Status != "expired" {
		t.Fatalf("swept, it reads %+v", e)
	}
	// And a month after that its row is gone. Jana is seen meanwhile: a session lasts 30 days from
	// its last use (D-95).
	p.clock.advance(16 * 24 * time.Hour)
	jana.me()
	p.clock.advance(15 * 24 * time.Hour)
	p.expire()
	expect(t, jana.get(path+"/"+queued.ID.String()), http.StatusNotFound, problem.CodeNotFound)
}

// A user asks for five exports of a kind in a day, and the sixth waits for the first to be a day old.
func TestExportsAreHeldToFiveADay(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	for i := range 5 {
		e := exportOf(t, jana.post("/me/exports", ""), http.StatusAccepted)
		if e.Scope != "user" || e.HouseholdID != nil {
			t.Fatalf("export %d queued as %+v", i, e)
		}
		p.work()
		if got := exportOf(t, jana.get("/me/exports/"+e.ID.String()), http.StatusOK); got.Status != "ready" {
			t.Fatalf("export %d is %q once the worker ran", i, got.Status)
		}
		p.clock.advance(time.Hour)
	}
	rec := jana.post("/me/exports", "")
	expect(t, rec, http.StatusTooManyRequests, problem.CodeRateLimited)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("the refusal names no time to try again")
	}
	p.clock.advance(20 * time.Hour)
	exportOf(t, jana.post("/me/exports", ""), http.StatusAccepted)
}

// An export whose archive the store refuses is tried again, and has failed after the third try: the
// job says so, and carries no link.
func TestAnExportThatFailsThreeTimesHasFailed(t *testing.T) {
	// A site with no bucket: every upload fails.
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	e := exportOf(t, jana.post("/me/exports", ""), http.StatusAccepted)
	for try := 1; try <= 3; try++ {
		s.privacy.Work(t.Context())
		if try < 3 {
			if got := exportOf(t, jana.get("/me/exports/"+e.ID.String()), http.StatusOK); got.Status != "queued" {
				t.Fatalf("after try %d it is %q, want it queued again", try, got.Status)
			}
		}
		s.clock.advance(6 * time.Minute)
	}
	if got := exportOf(t, jana.get("/me/exports/"+e.ID.String()), http.StatusOK); got.Status != "failed" || got.DownloadURL != nil {
		t.Fatalf("after three tries it reads %+v", got)
	}
	// Having failed, it is in nobody's way: a new one is queued.
	if again := exportOf(t, jana.post("/me/exports", ""), http.StatusAccepted); again.ID == e.ID {
		t.Fatal("a new request answered the failed export")
	}
}

// A member's own export takes what is theirs across their households (PRD 05 §3): their account, and
// from each household what they made and what they keep privately, the events they caused, and
// nothing of a module they cannot see. A household they left gives what they kept privately there,
// for the 30 days it is kept (FR-PR7), and nothing after.
func TestAMembersExportTakesWhatIsTheirs(t *testing.T) {
	p := newPrivacySite(t)
	jana := p.person("Jana", p.a("jana@tilcerovi.cz"))
	janaID := jana.me().ID
	h := jana.create("Tilcerovi")
	petr, petrID := p.joined(jana, h.ID, "Petr", p.a("petr@tilcerovi.cz"), "member", nil)
	chata := petr.create("Chata")
	p.probe(h.ID, map[uuid.UUID]string{janaID: "manage", petrID: "contribute"})
	p.item(h.ID, janaID, false, "společné.txt", "shared, Jana's")
	p.item(h.ID, janaID, true, "deník.txt", "Jana's own")
	made := p.item(h.ID, petrID, false, "nákup.txt", "shared, Petr made it")
	own := p.item(h.ID, petrID, true, "petr.txt", "Petr's own")

	take := func() (map[string]string, privacy.Manifest) {
		t.Helper()
		e := exportOf(t, petr.post("/me/exports", ""), http.StatusAccepted)
		p.work()
		ready := exportOf(t, petr.get("/me/exports/"+e.ID.String()), http.StatusOK)
		if ready.Status != "ready" || ready.DownloadURL == nil {
			t.Fatalf("ready as %+v", ready)
		}
		return p.stored(e.ID)
	}
	in := "households/" + h.ID.String() + "/"
	entries, m := take()
	want := []string{
		"account.json",
		"households/" + chata.ID.String() + "/activity-log.csv", "households/" + chata.ID.String() + "/admin.json",
		in + "activity-log.csv", in + "admin.json", in + "files/probe/nákup.txt", in + "files/probe/petr.txt", in + "probe-items.csv", in + "probe.json",
		"manifest.json",
	}
	slices.Sort(want)
	if got := names(entries); !slices.Equal(got, want) {
		t.Fatalf("the archive holds %v, want %v", got, want)
	}
	if m.Scope != "user" || m.RequestedBy != petrID || len(m.Households) != 2 || m.Households[0].Scope != module.ExportPersonal {
		t.Errorf("the manifest says %+v", m)
	}
	if got := probeItems(t, entries[in+"probe.json"]); !same(got, made, own) {
		t.Errorf("probe.json names %v, want what Petr made and what he keeps", got)
	}
	var account struct {
		Account struct {
			Profile struct {
				Email       string   `json:"email"`
				Credentials []string `json:"credentials"`
			} `json:"profile"`
			Sessions []json.RawMessage `json:"sessions"`
		} `json:"account"`
		Consents struct {
			Analytics bool `json:"analytics"`
		} `json:"consents"`
	}
	if err := json.Unmarshal([]byte(entries["account.json"]), &account); err != nil || account.Account.Profile.Email != p.a("petr@tilcerovi.cz") ||
		!slices.Equal(account.Account.Profile.Credentials, []string{"password"}) || len(account.Account.Sessions) != 1 ||
		strings.Contains(entries["account.json"], "argon2") || strings.Contains(entries["account.json"], "token") {
		t.Errorf("account.json holds %s (%v)", entries["account.json"], err)
	}
	// His own membership, and his own events: nobody else's.
	if admin := entries[in+"admin.json"]; !strings.Contains(admin, "Petr") || strings.Contains(admin, "jana@") {
		t.Errorf("admin.json holds %s", admin)
	}
	if log := entries[in+"activity-log.csv"]; !strings.Contains(log, "Petr,admin,member.join,") || strings.Contains(log, "household.create") {
		t.Errorf("his activity log reads:\n%s", log)
	}

	// A module he cannot see is left out of his export (PRD modules/00, absence 8).
	p.exec("UPDATE module_grants SET level = 'none' WHERE household_id = $1 AND user_id = $2 AND module = 'probe'", h.ID, petrID)
	entries, _ = take()
	if _, there := entries[in+"probe.json"]; there || entries[in+"admin.json"] == "" {
		t.Errorf("without the grant his export holds %v", names(entries))
	}

	// He leaves: for 30 days what he kept privately there is still his to take, and only that.
	expect(t, petr.post(householdPath(h.ID, "/leave"), ""), http.StatusNoContent, "")
	entries, m = take()
	want = []string{
		"account.json", "households/" + chata.ID.String() + "/activity-log.csv", "households/" + chata.ID.String() + "/admin.json",
		in + "files/probe/petr.txt", in + "probe-items.csv", in + "probe.json", "manifest.json",
	}
	slices.Sort(want)
	if got := names(entries); !slices.Equal(got, want) {
		t.Fatalf("having left, the archive holds %v, want %v", got, want)
	}
	if got := probeItems(t, entries[in+"probe.json"]); !same(got, own) || m.Households[1].Scope != module.ExportDeparted {
		t.Errorf("having left, probe.json names %v, in a part scoped %q", got, m.Households[1].Scope)
	}

	// The window ends: the nightly job deletes it, its file with it, and his export has nothing of the
	// household. Before it does, nothing goes.
	p.clock.advance(15 * 24 * time.Hour)
	petr.me()
	if p.erase(); p.count("SELECT count(*) FROM probe_items WHERE id = $1", own) != 1 {
		t.Fatal("halfway through the window the job erased his private item")
	}
	p.clock.advance(15*24*time.Hour + time.Minute)
	p.erase()
	p.files.Drain(t.Context(), h.ID)
	if n := p.count("SELECT count(*) FROM probe_items WHERE id = $1", own); n != 0 {
		t.Fatalf("his private item is still there")
	}
	if keys := p.objects("h/" + h.ID.String() + "/probe/" + own.String()); len(keys) != 0 {
		t.Fatalf("his private item's file is still there: %v", keys)
	}
	if n := p.count("SELECT count(*) FROM probe_items WHERE household_id = $1", h.ID); n != 3 {
		t.Fatalf("the household keeps %d items, want the three that were not his alone", n)
	}
	entries, _ = take()
	for name := range entries {
		if strings.HasPrefix(name, in) {
			t.Errorf("past the window his export still holds %s", name)
		}
	}
}
