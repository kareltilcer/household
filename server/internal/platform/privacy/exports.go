package privacy

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// An export's states, as the contract's ExportJob spells them.
const (
	statusQueued  = "queued"
	statusRunning = "running"
	statusReady   = "ready"
	statusFailed  = "failed"
	statusExpired = "expired"

	scopeUser      = "user"
	scopeHousehold = "household"
)

// The ceiling on the exports one user asks for of one kind, their own or one household's: five in a
// day (PRD 02 §9). An archive is hours of a worker and gigabytes of the store, and a day is how long
// one may take.
const (
	exportsPerDay = 5
	exportsWindow = 24 * time.Hour
)

// job is an export's row.
type job struct {
	id        uuid.UUID
	user      uuid.UUID
	household *uuid.UUID
	status    string
	requested time.Time
	ready     *time.Time
	expires   *time.Time
	size      *int64
	object    *string
	contents  []string
}

const jobColumns = "id, user_id, household_id, status, requested_at, ready_at, expires_at, size_bytes, object, contents"

func scanJob(row pgx.CollectableRow) (job, error) {
	var (
		j        job
		contents []byte
	)
	if err := row.Scan(&j.id, &j.user, &j.household, &j.status, &j.requested, &j.ready, &j.expires, &j.size, &j.object, &contents); err != nil {
		return j, err
	}
	return j, json.Unmarshal(contents, &j.contents)
}

// exportJSON is the contract's ExportJob.
type exportJSON struct {
	ID          uuid.UUID  `json:"id"`
	Scope       string     `json:"scope"`
	HouseholdID *uuid.UUID `json:"household_id"`
	Status      string     `json:"status"`
	RequestedAt time.Time  `json:"requested_at"`
	ReadyAt     *time.Time `json:"ready_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
	DownloadURL *string    `json:"download_url"`
	SizeBytes   *int64     `json:"size_bytes"`
	Contents    []string   `json:"contents"`
}

// archiveName is the name an archive downloads under: whose it is, and the day it was taken.
func archiveName(j job) string {
	kind := "household-account"
	if j.household != nil {
		kind = "household"
	}
	return kind + "-export-" + j.requested.UTC().Format(time.DateOnly) + ".zip"
}

// body is j as its requester reads it at now: an archive past its seven days reads as expired
// whether or not the sweep has reached it, and only one that is ready and in time carries a link,
// pre-signed for minutes as every link is (D-9), which each read of the job renews.
func (s *Service) body(ctx context.Context, j job, now time.Time) (exportJSON, error) {
	out := exportJSON{
		ID: j.id, Scope: scopeUser, HouseholdID: j.household, Status: j.status, RequestedAt: j.requested.UTC(),
		ReadyAt: utc(j.ready), ExpiresAt: utc(j.expires), SizeBytes: j.size, Contents: j.contents,
	}
	if j.household != nil {
		out.Scope = scopeHousehold
	}
	if out.Contents == nil {
		out.Contents = []string{}
	}
	if j.status != statusReady {
		return out, nil
	}
	if j.expires != nil && !now.Before(*j.expires) {
		out.Status = statusExpired
		return out, nil
	}
	url, _, err := s.cfg.Files.Store().Presign(ctx, *j.object, objectstore.Presentation{
		ContentType: "application/zip", Disposition: objectstore.Attachment, Filename: archiveName(j),
	}, now)
	if err != nil {
		return out, err
	}
	out.DownloadURL = &url
	return out, nil
}

// utc is t in UTC, nil for nil.
func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	at := t.UTC()
	return &at
}

// scopeOf is the user and the household a request for exports is about: the caller, and the
// household of a household-scoped route, nil for /me's.
func scopeOf(r *http.Request) (uuid.UUID, *uuid.UUID) {
	user, _ := auth.User(r.Context())
	if scope := tenant.From(r.Context()); scope != nil {
		household := scope.HouseholdID()
		return user, &household
	}
	return user, nil
}

// listExports is getMeExports and getExports: the caller's own exports, of everything about them or
// of the household, the newest first. An export is its requester's (ADR 0020): what it holds is what
// they may read, their private items among it and nobody else's, so no other member lists it, an
// owner included, and a member who asked for none reads an empty list.
func (s *Service) listExports(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, household := scopeOf(r)
	var jobs []job
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT "+jobColumns+` FROM exports
			WHERE user_id = $1 AND household_id IS NOT DISTINCT FROM $2
			ORDER BY requested_at DESC, id DESC LIMIT 50`, user, household)
		if err != nil {
			return err
		}
		jobs, err = pgx.CollectRows(rows, scanJob)
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	now := s.cfg.Now()
	items := make([]exportJSON, 0, len(jobs))
	for _, j := range jobs {
		b, err := s.body(ctx, j, now)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		items = append(items, b)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string][]exportJSON{"items": items})
}

// getExport is getMeExportsByExportId and getExportsByExportId: one of the caller's exports, with
// its link while it is ready. Anyone else's is not found.
func (s *Service) getExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, household := scopeOf(r)
	id, err := uuid.Parse(chi.URLParam(r, "export_id"))
	if err != nil {
		s.fail(w, r, problem.NotFound())
		return
	}
	var j job
	err = tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT "+jobColumns+` FROM exports
			WHERE id = $1 AND user_id = $2 AND household_id IS NOT DISTINCT FROM $3`, id, user, household)
		if err != nil {
			return err
		}
		j, err = pgx.CollectExactlyOneRow(rows, scanJob)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound()
		}
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	b, err := s.body(ctx, j, s.cfg.Now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, b)
}

// requestExport is postMeExports and postExports (FR-PR2, FR-HA15): an export is queued, and a
// worker builds it. A household's is an owner's to ask for, in every entitlement state but suspended
// (FR-BI1, D-32); a member's of everything about them is anyone's. While one of the same kind waits
// or runs, asking again answers that one, so that a retry or a second tap queues nothing twice; past
// five of a kind in a day, the request is refused 429 until the oldest is a day old.
func (s *Service) requestExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, household := scopeOf(r)
	if household != nil && tenant.From(ctx).Role() != access.Owner {
		s.fail(w, r, problem.New(http.StatusForbidden, problem.CodeForbidden))
		return
	}
	now := s.cfg.Now()
	var j job
	// The household's route keeps its Idempotency-Key in the household, and /me's on the account: the
	// transaction that queues the export is the one that commits whichever it is.
	inTx := func(fn func(pgx.Tx) error) error { return tenant.AccountTx(ctx, s.cfg.Pool, user, fn) }
	if household != nil {
		inTx = func(fn func(pgx.Tx) error) error { return tenant.InWriteTx(ctx, fn) }
	}
	err := inTx(func(tx pgx.Tx) error {
		// One request of a user's at a time: the count below, and the export under way, are read
		// and written under the user's lock.
		if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR NO KEY UPDATE", user); err != nil {
			return err
		}
		const mine = " FROM exports WHERE user_id = $1 AND household_id IS NOT DISTINCT FROM $2"
		rows, err := tx.Query(ctx, "SELECT "+jobColumns+mine+" AND status IN ('queued', 'running')", user, household)
		if err != nil {
			return err
		}
		active, err := pgx.CollectRows(rows, scanJob)
		if err != nil {
			return err
		}
		if len(active) > 0 {
			j = active[0]
			return idempotency.Commit(ctx, tx)
		}
		var (
			recent int
			oldest *time.Time
		)
		if err := tx.QueryRow(ctx, "SELECT count(*), min(requested_at)"+mine+" AND requested_at > $3",
			user, household, now.Add(-exportsWindow)).Scan(&recent, &oldest); err != nil {
			return err
		}
		if recent >= exportsPerDay {
			return ratelimit.Refusal(oldest.Add(exportsWindow).Sub(now))
		}
		rows, err = tx.Query(ctx, `
			INSERT INTO exports (id, user_id, household_id, requested_at, run_at) VALUES ($1, $2, $3, $4, $4)
			RETURNING `+jobColumns, idgen.New(), user, household, now)
		if err != nil {
			return err
		}
		if j, err = pgx.CollectExactlyOneRow(rows, scanJob); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Nudge()
	b, err := s.body(ctx, j, now)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, b)
}
