package files

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

func TestMain(m *testing.M) { testsupport.Main(m) }

// woken reports whether s's workers were woken, and takes the wake.
func woken(s *Service) bool {
	select {
	case <-s.wake:
		return true
	default:
		return false
	}
}

// A household found due while a worker drains it is looked at again once the worker lets it go: the
// job that made it due may have committed after the worker's last claim looked, and its commit's
// wake was spent finding the household held. A household nobody asked for again wakes nobody.
func TestAHouseholdFoundDueWhileHeldIsLookedAtAgain(t *testing.T) {
	s := &Service{wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{}}
	h := idgen.New()

	if !s.hold(h) {
		t.Fatal("a household nobody drains was not held")
	}
	s.release(h, false)
	if woken(s) {
		t.Fatal("letting go of a household nobody asked for again woke the workers")
	}

	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
	if s.hold(h) {
		t.Fatal("a household a worker drains was held twice")
	}
	s.release(h, false)
	if !woken(s) {
		t.Fatal("a household found due while it was held was left to the next poll")
	}
	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
	s.release(h, false)
	if woken(s) {
		t.Fatal("the second drain was asked for again too")
	}
}

// A household whose worker's turn ended with jobs perhaps left is looked at again once the others
// found due with it have had theirs: letting it go wakes the workers, though nothing found it due
// while it was held, rather than leaving the rest of its jobs to the next poll.
func TestAHouseholdWhoseTurnEndedIsLookedAtAgain(t *testing.T) {
	s := &Service{wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{}}
	h := idgen.New()
	if !s.hold(h) {
		t.Fatal("a household nobody drains was not held")
	}
	s.release(h, true)
	if !woken(s) {
		t.Fatal("a household whose turn ended was left to the next poll")
	}
	if !s.hold(h) {
		t.Fatal("a household let go was not held again")
	}
}

// A panic in what a job runs, a decoder's on a member's upload, fails the job for good rather than
// ending the process that runs it, and is logged by its type and the stack, never by its value,
// which may quote the file, and by the household whose job it was, which the workers, running in no
// request's scope, name themselves (FR-NF5).
func TestAJobThatPanicsFailsForGood(t *testing.T) {
	var logged bytes.Buffer
	s := &Service{log: logging.New(&logged, slog.LevelDebug)}
	household := idgen.New()
	err := s.guard(t.Context(), job{household: household, kind: "variants", module: "probe"}, func(context.Context, job) error {
		panic("Smlouva o dílo, strana 1")
	})
	if !errors.Is(err, errPermanent) {
		t.Fatalf("a job that panicked = %v, want a failure for good", err)
	}
	if out := logged.String(); !strings.Contains(out, "files: a job panicked") || strings.Contains(out, "Smlouva") ||
		!strings.Contains(out, `"household_id":"`+household.String()+`"`) {
		t.Fatalf("logged %s", out)
	}
	if err := s.guard(t.Context(), job{kind: "purge"}, func(context.Context, job) error { return errGone }); !errors.Is(err, errGone) {
		t.Fatalf("a job that did not panic = %v, want what it answered", err)
	}
}

// A job's time runs from before the claim that took it, never from once the claim has committed:
// its lease, past which another worker may take it, runs from the claim's now(), so a job timed from
// the commit would still be running when another worker could take it, and run twice at once.
func TestAJobEndsNoLaterThanItsLease(t *testing.T) {
	s := &Service{lease: 10 * time.Minute}
	claimed := time.Now().Add(-time.Minute)
	ctx, stop := s.leased(t.Context(), job{claimed: claimed})
	defer stop()
	if deadline, ok := ctx.Deadline(); !ok || !deadline.Equal(claimed.Add(s.lease)) {
		t.Fatalf("a job claimed at %s runs until %s, %t, with a lease of %s", claimed, deadline, ok, s.lease)
	}
}

// A claim takes one job, the household's that has waited longest, and leaves every other due. The
// claim's UPDATE once chose its job in a sub-select of its FROM, which PostgreSQL may run again for
// each row the UPDATE reads, each run skipping the job the one before had claimed: a single claim then
// took every job due in the household while its worker ran only the first, and the rest waited out a
// lease nobody ran them under, an attempt spent on each.
//
// Whether PostgreSQL runs it again depends on what it takes the household to hold, so the table is
// arranged as production's is: households with a job or so each, analyzed, as autovacuum leaves them,
// and then a burst of uploads in one household that the statistics do not count yet. Taking the
// household to hold a job or so, PostgreSQL reads its jobs first and runs the sub-select for each.
func TestAClaimTakesOneJob(t *testing.T) {
	d := testsupport.Open(t)
	admin := d.Pool(t, "")
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := admin.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Other households' jobs, each due longer than any of h's, which a claim in h never sees.
	households := make([]uuid.UUID, 100, 101)
	for i := range households {
		households[i] = idgen.New()
		exec(testsupport.InsertHousehold, households[i])
		exec(`INSERT INTO file_jobs (household_id, kind, module, entity_id, run_at)
		      VALUES ($1, 'variants', 'documents', $2, now() - interval '1 hour')`, households[i], idgen.New())
	}
	exec("ANALYZE file_jobs")

	// h's jobs, the one due longest first: two kinds of job for one entity, and jobs of two modules,
	// so that a job is told by its kind, its module and its entity. They are in the order of the
	// table's key and inserted in it, so that PostgreSQL, reading them by the table or by its key,
	// reads them in the order they fell due: a claim that took a second job would take them all.
	h := idgen.New()
	exec(testsupport.InsertHousehold, h)
	households = append(households, h)
	type key struct {
		kind, module string
		entity       uuid.UUID
	}
	a, b, c := idgen.New(), idgen.New(), idgen.New()
	jobs := []key{
		{"purge", "documents", a},
		{"purge", "notes", b},
		{"variants", "documents", a},
		{"variants", "documents", c},
		{"variants", "notes", b},
	}
	for i, k := range jobs {
		exec(`INSERT INTO file_jobs (household_id, kind, module, entity_id, run_at)
		      VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))`, h, k.kind, k.module, k.entity, len(jobs)-i)
	}

	s := &Service{pool: d.Pool(t, db.RoleApp), lease: lease}
	j, ok, err := s.claim(t.Context(), h)
	if err != nil || !ok {
		t.Fatalf("claim = %t, %v; want a job", ok, err)
	}
	if (key{j.kind, j.module, j.entity}) != jobs[0] || j.attempts != 1 {
		t.Fatalf("claimed %s %s %s at attempt %d; want %s %s %s at attempt 1",
			j.kind, j.module, j.entity, j.attempts, jobs[0].kind, jobs[0].module, jobs[0].entity)
	}

	rows, err := admin.Query(t.Context(), `
		SELECT household_id, kind, module, entity_id, attempts, claim IS NOT NULL, run_at <= now()
		FROM file_jobs WHERE household_id = ANY($1)`, households)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	read, claimed := 0, 0
	for rows.Next() {
		read++
		var (
			household     uuid.UUID
			k             key
			attempts      int
			held, waiting bool
		)
		if err := rows.Scan(&household, &k.kind, &k.module, &k.entity, &attempts, &held, &waiting); err != nil {
			t.Fatal(err)
		}
		switch {
		case household == h && k == jobs[0]:
			claimed++
			if attempts != 1 || !held || waiting {
				t.Errorf("the job claimed, %s %s %s: attempts %d, held %t, due %t", k.kind, k.module, k.entity, attempts, held, waiting)
			}
		case attempts != 0 || held || !waiting:
			claimed++
			t.Errorf("a job not claimed, %s %s %s in %s: attempts %d, held %t, due %t",
				k.kind, k.module, k.entity, household, attempts, held, waiting)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if read != len(households)-1+len(jobs) || claimed != 1 {
		t.Fatalf("one claim took %d of the %d jobs", claimed, read)
	}
}
