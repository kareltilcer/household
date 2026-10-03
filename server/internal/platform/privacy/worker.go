package privacy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/entitlement"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/notify"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// maxAttempts is how many times an export is tried before it has failed: the request said within a
// day, and a household whose export fails three times is one whose fourth would too.
const maxAttempts = 3

// emailExportReady tells an export's requester that it is ready (A-35): they closed the app.
const emailExportReady mail.Template = "email.export_ready"

// Nudge wakes the worker: a request that queued an export calls it once it has committed, so that
// the export starts now rather than at the next poll.
func (s *Service) Nudge() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Run builds the exports that are queued, one at a time, until ctx ends: every instance runs it, and
// a job is one instance's while its lease holds. A job whose worker died is taken again once its
// lease has passed.
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(s.cfg.Poll)
	defer tick.Stop()
	for {
		s.Work(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		case <-s.wake:
		}
	}
}

// Work builds every export that is due, and returns how many it finished, ready or failed for good.
func (s *Service) Work(ctx context.Context) int {
	done := 0
	for ctx.Err() == nil {
		j, claim, ok, err := s.claim(ctx)
		if err != nil {
			s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: claim an export", slog.Any("error", err))
			return done
		}
		if !ok {
			return done
		}
		if s.run(ctx, j, claim) {
			done++
		}
	}
	return done
}

// claim takes the export that has waited longest, moving it past the lease, and returns it, with
// this try counted among its attempts, and the claim that names the try.
func (s *Service) claim(ctx context.Context) (job, uuid.UUID, bool, error) {
	var (
		j     job
		claim = idgen.New()
		now   = s.cfg.Now()
	)
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			UPDATE exports SET status = 'running', claim = $1, attempts = attempts + 1, run_at = $2
			WHERE id = (
			  SELECT id FROM exports WHERE status IN ('queued', 'running') AND run_at <= $3
			  ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
			RETURNING `+jobColumns, claim, now.Add(s.cfg.Lease), now)
		if err != nil {
			return err
		}
		j, err = pgx.CollectExactlyOneRow(rows, scanJob)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return j, claim, false, nil
	}
	return j, claim, err == nil, err
}

// objectKey is where the archive of user's export id, as the try claim built it, is kept: under the
// account's own prefix, which goes with the account (FR-PR4), and under the try's own name, so that a
// try that died after it stored its bytes is never mistaken for the one that finished.
func objectKey(user, id, claim uuid.UUID) string {
	return fmt.Sprintf("u/%s/exports/%s/%s", user, id, claim)
}

// run builds j under claim and settles it: ready with its archive, or back in the queue after a
// failure, or failed for good after maxAttempts of them, nothing partial kept. It reports whether j
// ended.
func (s *Service) run(ctx context.Context, j job, claim uuid.UUID) bool {
	log := []slog.Attr{slog.String("export_id", j.id.String()), slog.String("user_id", j.user.String())}
	if j.attempts > maxAttempts {
		// A try that never settled, its worker dead each time, counted too.
		s.settle(ctx, j, claim, statusFailed, "", 0, nil, log)
		return true
	}
	leased, cancel := context.WithDeadline(ctx, s.cfg.Now().Add(s.cfg.Lease))
	defer cancel()
	object := objectKey(j.user, j.id, claim)
	size, contents, err := s.build(leased, j, object)
	if err != nil {
		// What the store kept of a try that failed after its upload is removed past the lease's end.
		_ = s.cfg.Files.Store().Delete(context.WithoutCancel(ctx), object)
		if ctx.Err() != nil {
			// The process is stopping: the job goes back as it was taken, for whoever runs next, this
			// try not counted, rather than waiting out a lease nobody holds.
			s.settle(ctx, j, claim, statusReleased, "", 0, nil, log)
			return false
		}
		s.cfg.Log.LogAttrs(ctx, slog.LevelWarn, "privacy: an export failed", append(log, slog.Int("attempt", j.attempts), slog.Any("error", err))...)
		if j.attempts >= maxAttempts || errors.Is(err, errGone) {
			s.settle(ctx, j, claim, statusFailed, "", 0, nil, log)
			return true
		}
		s.settle(ctx, j, claim, statusQueued, "", 0, nil, log)
		return false
	}
	if !s.settle(ctx, j, claim, statusReady, object, size, contents, log) {
		_ = s.cfg.Files.Store().Delete(context.WithoutCancel(ctx), object)
		return false
	}
	s.ready(ctx, j)
	return true
}

// retry is how long a failed export waits before its next try.
const retry = 5 * time.Minute

// statusReleased is what settle is told of a try its process ended before it could finish: no state
// of an export, which is queued again.
const statusReleased = "released"

// settle writes what became of j's try under claim, and reports whether it did: a try whose claim
// another has since taken, its lease passed, writes nothing.
func (s *Service) settle(ctx context.Context, j job, claim uuid.UUID, status, object string, size int64, contents []string, log []slog.Attr) bool {
	ctx = context.WithoutCancel(ctx)
	now := s.cfg.Now()
	var tag int64
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		var (
			statement string
			args      = []any{j.id, claim}
		)
		switch status {
		case statusReady:
			list, err := json.Marshal(contents)
			if err != nil {
				return err
			}
			statement = `UPDATE exports SET status = 'ready', claim = NULL, object = $3, size_bytes = $4, contents = $5,
				ready_at = $6, expires_at = $7, ended_at = $6 WHERE id = $1 AND claim = $2`
			args = append(args, object, size, list, now, now.Add(ArchiveKept))
		case statusFailed:
			statement = "UPDATE exports SET status = 'failed', claim = NULL, ended_at = $3 WHERE id = $1 AND claim = $2"
			args = append(args, now)
		case statusReleased:
			statement = `UPDATE exports SET status = 'queued', claim = NULL, run_at = $3, attempts = greatest(attempts - 1, 0)
				WHERE id = $1 AND claim = $2`
			args = append(args, now)
		default:
			statement = "UPDATE exports SET status = 'queued', claim = NULL, run_at = $3 WHERE id = $1 AND claim = $2"
			args = append(args, now.Add(retry))
		}
		t, err := tx.Exec(ctx, statement, args...)
		tag = t.RowsAffected()
		return err
	})
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: settle an export", append(log, slog.Any("error", err))...)
		return false
	}
	return tag > 0
}

// ready emails j's requester that their export is ready, at their address if it is verified, with a
// link to where it is listed: the archive's own link is issued to whoever is signed in as them, for
// minutes, and is in no email.
func (s *Service) ready(ctx context.Context, j job) {
	var (
		address  *string
		locale   string
		verified bool
		name     string
	)
	err := tenant.AccountTx(ctx, s.cfg.Pool, j.user, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, "SELECT email, locale, email_verified_at IS NOT NULL FROM users WHERE id = $1", j.user).
			Scan(&address, &locale, &verified); err != nil || j.household == nil {
			return err
		}
		// Outside any household, a user reads the households they belong to.
		err := tx.QueryRow(ctx, "SELECT name FROM households WHERE id = $1", *j.household).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil {
		s.cfg.Log.LogAttrs(ctx, slog.LevelError, "privacy: an export's email", slog.String("export_id", j.id.String()), slog.Any("error", err))
		return
	}
	if address == nil || !verified {
		return
	}
	route, kind := "account/privacy", scopeUser
	if j.household != nil {
		route, kind = "households/"+j.household.String()+"/exports", scopeHousehold
	}
	s.cfg.Accounts.SendLink(ctx, *address, locale, emailExportReady, route, "",
		i18n.Args{"kind": kind, "household": name, "days": int(ArchiveKept / (24 * time.Hour))})
}

// errGone ends an export that can no longer be built: its requester is no longer an owner of the
// household it was of, or the household is gone or suspended.
var errGone = errors.New("privacy: the export's requester may no longer take it")

// build writes j's archive to the store at object, as it is built, and returns its length and its
// top-level entries.
func (s *Service) build(ctx context.Context, j job, object string) (int64, []string, error) {
	pr, pw := io.Pipe()
	var (
		contents []string
		written  error
		done     = make(chan struct{})
	)
	go func() {
		defer close(done)
		contents, written = s.write(ctx, j, pw)
		_ = pw.CloseWithError(written)
	}()
	size, err := s.cfg.Files.Store().Upload(ctx, object, pr, "application/zip")
	// The writer ends once the reader is closed, with the upload's error if that failed first.
	_ = pr.CloseWithError(err)
	<-done
	if written != nil {
		return 0, nil, written
	}
	return size, contents, err
}

// write writes j's archive to w: a household's, at the archive's root, or its requester's own,
// their account and then each household they belong to or left within its window, and the manifest
// last. It returns the archive's top-level entries.
func (s *Service) write(ctx context.Context, j job, w io.Writer) ([]string, error) {
	now := s.cfg.Now()
	a := newArchive(w, now)
	m := Manifest{
		SchemaVersion: SchemaVersion, APIVersion: s.cfg.APIVersion, Scope: scopeUser, GeneratedAt: now.UTC(), RequestedBy: j.user,
		Households: []ManifestHousehold{},
	}
	var locale string
	err := tenant.AccountTx(ctx, s.cfg.Pool, j.user, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT locale FROM users WHERE id = $1", j.user).Scan(&locale)
	})
	if err != nil {
		return nil, err
	}
	lang := i18n.Match(locale)
	if j.household != nil {
		m.Scope = scopeHousehold
		h, err := s.household(ctx, a, "", *j.household, j.user, module.ExportHousehold, lang)
		if err != nil {
			return nil, err
		}
		m.Households = append(m.Households, h)
	} else {
		if err := s.account(ctx, a, j.user); err != nil {
			return nil, err
		}
		households, err := s.householdsOf(ctx, j.user)
		if err != nil {
			return nil, err
		}
		for _, h := range households {
			part, err := s.household(ctx, a, "households/"+h.id.String()+"/", h.id, j.user, h.scope, lang)
			if errors.Is(err, errGone) {
				// A household that went, or was suspended, since the list was read: left out (D-115).
				continue
			}
			if err != nil {
				return nil, err
			}
			m.Households = append(m.Households, part)
		}
	}
	if err := a.finish(m); err != nil {
		return nil, err
	}
	return a.contents(), nil
}

// account writes account.json, what the platform keeps of user's account outside any household
// (PRD 05 §3): their profile and how they sign in, as identity keeps them, what they consented to,
// what they asked to be told, and the diagnostic bundles they sent that are still kept.
func (s *Service) account(ctx context.Context, a *archive, user uuid.UUID) error {
	out := map[string]any{}
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		profile, err := s.cfg.Accounts.Export(ctx, tx, user)
		if err != nil {
			return err
		}
		consents, err := readConsents(ctx, tx, user)
		if err != nil {
			return err
		}
		notifications, err := notify.AccountExport(ctx, tx, user)
		if err != nil {
			return err
		}
		var bundles []byte
		if err := tx.QueryRow(ctx, `
			SELECT coalesce(jsonb_agg(to_jsonb(b) - 'user_id' ORDER BY b.created_at), '[]')
			FROM diagnostic_bundles b WHERE b.user_id = $1`, user).Scan(&bundles); err != nil {
			return err
		}
		out = map[string]any{
			"account": profile, "consents": consents, "notifications": notifications, "diagnostic_bundles": json.RawMessage(bundles),
		}
		return nil
	})
	if err != nil {
		return err
	}
	w, err := a.create(accountName, false)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

// taken is a household a user's own export takes a part of, and how much of it.
type taken struct {
	id    uuid.UUID
	scope module.ExportScope
}

// householdsOf are the households user's own export takes a part of: each they belong to, in the
// order they joined, and then each they left whose window is still open (FR-PR7), which the meter
// role finds across households, since no member reads a household they are not in.
func (s *Service) householdsOf(ctx context.Context, user uuid.UUID) ([]taken, error) {
	var out []taken
	err := tenant.AccountTx(ctx, s.cfg.Pool, user, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT household_id FROM memberships WHERE user_id = $1 ORDER BY created_at, id", user)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		for _, id := range ids {
			out = append(out, taken{id: id, scope: module.ExportPersonal})
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	rows, err := s.cfg.Meter.Query(ctx, `
		SELECT household_id FROM departures WHERE user_id = $1 AND erased_at IS NULL ORDER BY household_id`, user)
	if err != nil {
		return nil, err
	}
	left, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, err
	}
	for _, id := range left {
		if !slices.ContainsFunc(out, func(t taken) bool { return t.id == id }) {
			out = append(out, taken{id: id, scope: module.ExportDeparted})
		}
	}
	return out, nil
}

// household writes one household's part of an archive under prefix, for user: each module's data
// that scope takes of it, then the activity log, then the files the modules named. An owner's export
// takes every module, a disabled one's data among them, which is the household's still (PRD 01 §5);
// a member's own takes the modules they can see, and their own events; one who left takes their
// private items alone. It reads in the household's own context, with no caller, as a job does:
// which rows are the requester's to take is each module's to decide (module.Export).
//
// It answers errGone for a household that is gone or suspended, whose content nobody reads (D-115),
// and for a household's export whose requester is no longer its owner.
func (s *Service) household(ctx context.Context, a *archive, prefix string, id, user uuid.UUID, scope module.ExportScope, locale i18n.Locale,
) (ManifestHousehold, error) {
	out := ManifestHousehold{ID: id, Path: strings.TrimSuffix(prefix, "/"), Scope: scope, Modules: []string{}}
	sources := sources(s.cfg.Registry)
	platform := map[string]bool{}
	for _, p := range s.cfg.Registry.Platform() {
		platform[p.Name] = true
	}
	for _, src := range sources {
		a.reserve(prefix + src.name + ".json")
	}
	a.reserve(prefix + activityName)
	var named []pending
	err := tenant.InTx(s.system(ctx, id), func(tx pgx.Tx) error {
		var (
			row  entitlement.Row
			role string
		)
		err := tx.QueryRow(ctx, "SELECT name FROM households WHERE id = $1", id).Scan(&out.Name)
		if errors.Is(err, pgx.ErrNoRows) {
			return errGone
		}
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, entitlement.Query, id).Scan(row.Dest()...); err != nil {
			return err
		}
		status, err := row.Status()
		if err != nil {
			return err
		}
		if !status.State().Reads() {
			return errGone
		}
		err = tx.QueryRow(ctx, "SELECT role::text FROM memberships WHERE household_id = $1 AND user_id = $2", id, user).Scan(&role)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		e := module.Export{Household: id, Requester: user, Role: access.Role(role), Scope: scope}
		var asked []string
		switch scope {
		case module.ExportHousehold:
			if e.Role != access.Owner {
				return errGone
			}
			for _, src := range sources {
				asked = append(asked, src.name)
			}
		case module.ExportPersonal:
			if role == "" {
				// They left between the list and now: what they kept privately is still theirs to take.
				e.Scope, out.Scope = module.ExportDeparted, module.ExportDeparted
				for _, src := range sources {
					asked = append(asked, src.name)
				}
				break
			}
			levels, err := tenant.Levels(ctx, tx, id, user, e.Role)
			if err != nil {
				return err
			}
			asked = visible(sources, platform, levels)
		case module.ExportDeparted:
			for _, src := range sources {
				asked = append(asked, src.name)
			}
		}
		for _, src := range sources {
			if src.export == nil || !slices.Contains(asked, src.name) {
				continue
			}
			if err := src.export(ctx, tx, e, &part{a: a, prefix: prefix, module: src.name, files: &named}); err != nil {
				return fmt.Errorf("privacy: export %s: %w", src.name, err)
			}
			out.Modules = append(out.Modules, src.name)
		}
		if e.Scope == module.ExportDeparted {
			return nil
		}
		w, err := a.create(prefix+activityName, false)
		if err != nil {
			return err
		}
		var only []string
		if e.Scope == module.ExportPersonal {
			only = asked
		}
		return s.activity(ctx, tx, w, id, user, locale, only)
	})
	if err != nil {
		return out, err
	}
	return out, s.copyFiles(ctx, a, id, named)
}

// Expire is the expiry sweep's part of the exports (PRD 03 §5): an archive seven days after it was
// ready is removed from the store and its export marked expired; an archive in the store that no
// ready export names, which a try that died or an expiry that failed halfway left, is removed once
// it is a day old; and an export's row goes 30 days after it ended. It returns how many archives it
// removed.
func (s *Service) Expire(ctx context.Context) (int, error) {
	now := s.cfg.Now()
	type expired struct {
		id     uuid.UUID
		object string
	}
	var due []expired
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT id, object FROM exports WHERE status = 'ready' AND expires_at <= $1 ORDER BY id", now)
		if err != nil {
			return err
		}
		due, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (expired, error) {
			var e expired
			err := row.Scan(&e.id, &e.object)
			return e, err
		})
		return err
	})
	if err != nil {
		return 0, err
	}
	removed := 0
	store := s.cfg.Files.Store()
	for _, e := range due {
		// The bytes first: a row marked expired names none, and the sweep below finds what a failure
		// between the two left.
		if err := store.Delete(ctx, e.object); err != nil {
			return removed, err
		}
		if err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `
				UPDATE exports SET status = 'expired', object = NULL, ended_at = $2 WHERE id = $1 AND status = 'ready'`, e.id, now)
			return err
		}); err != nil {
			return removed, err
		}
		removed++
	}
	swept, err := s.sweep(ctx, now)
	removed += swept
	if err != nil {
		return removed, err
	}
	return removed, tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "DELETE FROM exports WHERE ended_at < $1", now.Add(-JobsKept))
		return err
	})
}

// sweep removes the archives under the accounts' prefix that are a day old and that no ready export
// names, and returns how many. It lists the old ones first and reads the rows after, as the files
// sweep does, so that an export made ready while the listing ran keeps its archive.
func (s *Service) sweep(ctx context.Context, now time.Time) (int, error) {
	cutoff := now.Add(-files.SweepGrace)
	var old []string
	if err := s.cfg.Files.Store().List(ctx, "u/", func(o objectstore.Info) error {
		if strings.Contains(o.Key, "/exports/") && o.LastModified.Before(cutoff) {
			old = append(old, o.Key)
		}
		return nil
	}); err != nil || len(old) == 0 {
		return 0, err
	}
	named := map[string]bool{}
	err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT object FROM exports WHERE object = ANY ($1)", old)
		if err != nil {
			return err
		}
		objects, err := pgx.CollectRows(rows, pgx.RowTo[string])
		for _, o := range objects {
			named[o] = true
		}
		return err
	})
	if err != nil {
		return 0, err
	}
	orphans := slices.DeleteFunc(old, func(k string) bool { return named[k] })
	return len(orphans), s.cfg.Files.Store().Delete(ctx, orphans...)
}
