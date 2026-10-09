package replica

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// ConfirmAfter is how long after a replica's report first disagreed with the server on an entity type
// a later report must come for its disagreeing again to be divergence (D-125): a replica at rest
// would have received in that time any row the server held still for it.
const ConfirmAfter = time.Minute

// maxLabel is the longest label a replica keeps, in characters, and maxVersion the longest version
// of its client: the sync_replicas columns'. A version the Household-Client header admits is
// shorter than that (clientversion.ParseVersion).
const (
	maxLabel   = 256
	maxVersion = 160
)

// The stages of a replica's downloading itself again (sync_replicas.resnapshot).
const (
	resnapshotNone   = "none"
	resnapshotMarked = "marked"
	resnapshotTold   = "told"
)

// ReportsConfig is what the replicas' reports need.
type ReportsConfig struct {
	// Registry holds the entities a replica reports on, the platform's among them.
	Registry *module.Registry
	Logger   *slog.Logger
	// Metrics is told of each report's queue and of each divergence it finds; sync.LogMetrics on Logger
	// when nil.
	Metrics sync.Metrics
	// MinClients are the oldest clients the deployment serves, the ones the client-version middleware
	// refuses below, which an owner reads beside the household's clients (getClients); none when nil.
	MinClients clientversion.Minimums
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

// Reports are the replicas' reports of themselves (plan item 18, D-125, ADR 0019): a replica reports
// at rest what it holds and its health, the server answers whether it holds what its member may see
// and whether it must download itself again, and the member reads each of their replicas' last
// report on the sync-health screen. A report also says which client sent it, and an owner reads the
// household's clients and their versions off the reports (plan item 27, FR-HA18, ADR 0028).
type Reports struct {
	entities []sync.Entity
	log      *slog.Logger
	metrics  sync.Metrics
	minimums minimumsJSON
	now      func() time.Time
}

// NewReports returns the reports for cfg.
func NewReports(cfg ReportsConfig) (*Reports, error) {
	if cfg.Registry == nil || cfg.Logger == nil {
		return nil, errors.New("replica: the reports need the module registry and a logger")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Metrics == nil {
		cfg.Metrics = sync.LogMetrics{Log: cfg.Logger}
	}
	return &Reports{
		entities: cfg.Registry.Entities(), log: cfg.Logger, metrics: cfg.Metrics, minimums: minimumsOf(cfg.MinClients), now: cfg.Now,
	}, nil
}

// Routes registers the reports, which the router mounts in the household, behind the tenant
// middleware and the household's Idempotency-Key:
//
//	POST /households/{household_id}/sync/digest   postSyncDigest
//	POST /households/{household_id}/sync/reset    postSyncReset
//	GET  /households/{household_id}/sync/state    getSyncState
//	GET  /households/{household_id}/clients       getClients
func (s *Reports) Routes(r chi.Router) {
	r.Post("/households/{"+tenant.Param+"}/sync/digest", s.digest)
	r.Post("/households/{"+tenant.Param+"}/sync/reset", s.reset)
	r.Get("/households/{"+tenant.Param+"}/sync/state", s.state)
	r.Get("/households/{"+tenant.Param+"}/clients", s.clients)
}

// reportIn is the contract's ReplicaDigest.
type reportIn struct {
	ReplicaID  uuid.UUID `json:"replica_id"`
	Checkpoint string    `json:"checkpoint"`
	Algorithm  *string   `json:"algorithm"`
	Health     struct {
		PendingMutations int `json:"pending_mutations"`
		Unresolved       int `json:"unresolved"`
		ChecksumFailures int `json:"checksum_failures"`
	} `json:"health"`
	Entries []struct {
		EntityType string `json:"entity_type"`
		Hash       string `json:"hash"`
		Count      int64  `json:"count"`
	} `json:"entries"`
}

// verdictEntry and verdictBody are the contract's ReplicaDigestVerdict.
type verdictEntry struct {
	EntityType  string `json:"entity_type"`
	Matched     bool   `json:"matched"`
	ServerCount int64  `json:"server_count"`
}

type verdictBody struct {
	Matched            bool           `json:"matched"`
	ResnapshotRequired bool           `json:"resnapshot_required"`
	Entries            []verdictEntry `json:"entries"`
}

// mismatch is an entity type a replica's reports have disagreed on since a time, and the server's
// own hash of it then (sync_replicas.mismatches).
type mismatch struct {
	Since      time.Time `json:"since"`
	ServerHash string    `json:"server_hash"`
}

// digest answers a replica's report: per entity type it reports, whether it holds what the caller may
// see, by count and hash; and whether it must download itself again, because a disagreement held for
// ConfirmAfter against a server hash that held still, or because its member asked (reset). An entity
// type the replica does not report is not compared, since an app older than the server subscribes to
// fewer streams; one the server does not sync is answered as disagreeing, and never as divergence,
// which downloading again cannot mend. The report is kept, for the sync-health screen and the next
// report's comparison, with the client that sent it, as its Household-Client header named it, and
// its queue and any checksum failures are told to the metrics.
func (s *Reports) digest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	requestID := reqctx.RequestID(ctx)
	var in reportIn
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	if in.Algorithm != nil && *in.Algorithm != Algorithm {
		problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "/algorithm", Code: "enum"}))
		return
	}
	seen := map[string]bool{}
	for i, e := range in.Entries {
		if seen[e.EntityType] {
			problem.Write(w, requestID, problem.Validation(problem.FieldError{
				Field: problem.Pointer("entries", strconv.Itoa(i), "entity_type"), Code: "unique_items",
			}))
			return
		}
		seen[e.EntityType] = true
	}
	scope := tenant.From(ctx)
	// Only the entity types the report names are compared, so only theirs are read.
	reported := make([]sync.Entity, 0, len(in.Entries))
	for _, e := range s.entities {
		if seen[e.Name] {
			reported = append(reported, e)
		}
	}
	var expected map[string]Digest
	if err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		expected, err = Expected(ctx, tx, scope, reported)
		return err
	}); err != nil {
		s.fail(ctx, w, err)
		return
	}

	now := s.now().UTC()
	out := verdictBody{Matched: true, Entries: make([]verdictEntry, 0, len(in.Entries))}
	var mismatched, diverged []string
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		out.Matched, out.ResnapshotRequired, out.Entries = true, false, out.Entries[:0]
		var (
			owner    uuid.UUID
			stage    = resnapshotNone
			previous = map[string]mismatch{}
			raw      []byte
		)
		err := tx.QueryRow(ctx, `SELECT user_id, mismatches, resnapshot FROM sync_replicas WHERE household_id = $1 AND id = $2 FOR UPDATE`,
			scope.HouseholdID(), in.ReplicaID).Scan(&owner, &raw, &stage)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return err
		default:
			if owner != scope.UserID() {
				// Another member's replica, which this caller may not report for.
				return problem.NotFound()
			}
			if err := json.Unmarshal(raw, &previous); err != nil {
				return err
			}
		}

		mismatches := map[string]mismatch{}
		mismatched, diverged = []string{}, nil
		for _, e := range in.Entries {
			d, known := expected[e.EntityType]
			matched := known && d.Count == e.Count && d.Hex() == e.Hash
			out.Entries = append(out.Entries, verdictEntry{EntityType: e.EntityType, Matched: matched, ServerCount: d.Count})
			if matched {
				continue
			}
			out.Matched = false
			mismatched = append(mismatched, e.EntityType)
			if !known {
				continue
			}
			p, had := previous[e.EntityType]
			switch {
			case had && p.ServerHash == d.Hex() && now.Sub(p.Since) >= ConfirmAfter:
				diverged = append(diverged, e.EntityType)
			case had && p.ServerHash == d.Hex():
				mismatches[e.EntityType] = p
			default:
				mismatches[e.EntityType] = mismatch{Since: now, ServerHash: d.Hex()}
			}
		}
		switch {
		case len(diverged) > 0 || stage == resnapshotMarked:
			// Told now, it downloads itself again once its queue has drained, and compares afresh.
			out.ResnapshotRequired = true
			stage = resnapshotTold
			mismatches = map[string]mismatch{}
		case stage == resnapshotTold:
			// The report it sends once it has downloaded itself again.
			stage = resnapshotNone
		}
		slices.Sort(mismatched)
		encoded, err := json.Marshal(mismatches)
		if err != nil {
			return err
		}
		deviceID, label, err := s.reporter(ctx, tx)
		if err != nil {
			return err
		}
		clientType, clientVersion := reportedBy(ctx)
		// A replica's first report inserts it; two first reports racing write one after the other, the
		// later over the earlier, since neither held a row to lock. A replica another member reported
		// first is not theirs to write. Each report says anew which client sent it: an app updated since
		// its replica's last report is listed at the version it is now.
		tag, err := tx.Exec(ctx, `
			INSERT INTO sync_replicas (household_id, id, user_id, device_id, label, checkpoint, reported_at,
			  pending_mutations, unresolved, checksum_failures, mismatched, mismatches, resnapshot, client_type, client_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			ON CONFLICT (household_id, id) DO UPDATE SET device_id = EXCLUDED.device_id, label = EXCLUDED.label,
			  checkpoint = EXCLUDED.checkpoint, reported_at = EXCLUDED.reported_at, pending_mutations = EXCLUDED.pending_mutations,
			  unresolved = EXCLUDED.unresolved, checksum_failures = EXCLUDED.checksum_failures, mismatched = EXCLUDED.mismatched,
			  mismatches = EXCLUDED.mismatches, resnapshot = EXCLUDED.resnapshot, client_type = EXCLUDED.client_type,
			  client_version = EXCLUDED.client_version
			WHERE sync_replicas.user_id = EXCLUDED.user_id`,
			scope.HouseholdID(), in.ReplicaID, scope.UserID(), deviceID, label, nullable(in.Checkpoint), now,
			in.Health.PendingMutations, in.Health.Unresolved, in.Health.ChecksumFailures, mismatched, encoded, stage,
			clientType, clientVersion)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return problem.NotFound()
		}
		return idempotency.Commit(ctx, tx)
	})
	if memberGone(err) {
		// Answered as the tenant middleware answers their next request.
		err = problem.NotFound()
	}
	if err != nil {
		s.fail(ctx, w, err)
		return
	}
	// Told once the report is kept: a report that failed is sent again, and found divergent then.
	for _, entity := range diverged {
		s.metrics.Diverged(ctx, entity, "digest")
	}
	s.metrics.Queue(ctx, in.Health.PendingMutations)
	if in.Health.ChecksumFailures > 0 {
		s.metrics.Diverged(ctx, "", "checksum")
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// memberGone reports whether err is a report refused a place in sync_replicas for want of its
// member's membership: the caller was removed from the household, or left it, while their report was
// answered, and their replicas' reports went with the membership (ON DELETE CASCADE), which the tenant
// middleware had let the request in by.
func memberGone(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503" && pgErr.TableName == "sync_replicas"
}

// reporter returns the device the request was signed in from, or none for a web session, and the
// label the replica is shown by: the device's, or the browser's.
func (s *Reports) reporter(ctx context.Context, tx pgx.Tx) (*uuid.UUID, string, error) {
	var label string
	if current, ok := device.From(ctx); ok {
		err := tx.QueryRow(ctx, `SELECT label FROM devices WHERE user_id = $1 AND id = $2`,
			tenant.From(ctx).UserID(), current.Device).Scan(&label)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, "", err
		}
		id := current.Device
		return &id, cut(label, maxLabel), nil
	}
	if sid, ok := session.Current(ctx); ok {
		err := tx.QueryRow(ctx, `SELECT user_agent FROM sessions WHERE id = $1`, sid).Scan(&label)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, "", err
		}
	}
	return nil, cut(label, maxLabel), nil
}

// reportedBy is the client ctx's request named in Household-Client (clientversion), as a report
// keeps it: its type, and its version as the client wrote it, the build after a "+" included, which
// tells one build of the web app from another. Both are nil for a request that named no client,
// which is none of Household's own.
func reportedBy(ctx context.Context) (clientType, version *string) {
	c, named := clientversion.From(ctx)
	if !named {
		return nil, nil
	}
	raw := cut(c.Raw, maxVersion)
	return &c.Type, &raw
}

// cut is s as a column keeps it: at most limit characters.
func cut(s string, limit int) string {
	if r := []rune(s); len(r) > limit {
		return string(r[:limit])
	}
	return s
}

// nullable is s, or nil when it is empty.
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// reset marks one of the caller's replicas of the household to download itself again: it is told so
// at its next report. Another member's replica is not found.
func (s *Reports) reset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var in struct {
		ReplicaID uuid.UUID `json:"replica_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		problem.Write(w, reqctx.RequestID(ctx), problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	scope := tenant.From(ctx)
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE sync_replicas SET resnapshot = $4 WHERE household_id = $1 AND id = $2 AND user_id = $3`,
			scope.HouseholdID(), in.ReplicaID, scope.UserID(), resnapshotMarked)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return problem.NotFound()
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(ctx, w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// replicaState is one replica of the contract's SyncState.
type replicaState struct {
	ReplicaID                 uuid.UUID  `json:"replica_id"`
	DeviceID                  *uuid.UUID `json:"device_id"`
	Label                     string     `json:"label"`
	Checkpoint                *string    `json:"checkpoint"`
	LastReportAt              *time.Time `json:"last_report_at"`
	PendingMutations          int        `json:"pending_mutations"`
	UnresolvedConflicts       int        `json:"unresolved_conflicts"`
	ChecksumFailures          int        `json:"checksum_failures"`
	NeedsResnapshot           bool       `json:"needs_resnapshot"`
	DigestMismatchEntityTypes []string   `json:"digest_mismatch_entity_types"`
}

// state answers each of the caller's replicas of the household as it last reported itself, the one
// that reported last first.
func (s *Reports) state(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope := tenant.From(ctx)
	replicas := []replicaState{}
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, device_id, label, checkpoint, reported_at, pending_mutations, unresolved, checksum_failures,
			  resnapshot <> 'none', mismatched
			FROM sync_replicas WHERE household_id = $1 AND user_id = $2 ORDER BY reported_at DESC, id`,
			scope.HouseholdID(), scope.UserID())
		if err != nil {
			return err
		}
		var (
			rs       replicaState
			reported time.Time
		)
		_, err = pgx.ForEachRow(rows, []any{&rs.ReplicaID, &rs.DeviceID, &rs.Label, &rs.Checkpoint, &reported,
			&rs.PendingMutations, &rs.UnresolvedConflicts, &rs.ChecksumFailures, &rs.NeedsResnapshot, &rs.DigestMismatchEntityTypes},
			func() error {
				at := reported.UTC()
				rs.LastReportAt = &at
				replicas = append(replicas, rs)
				return nil
			})
		return err
	})
	if err != nil {
		s.fail(ctx, w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, struct {
		Replicas []replicaState `json:"replicas"`
	}{replicas})
}

// fail answers err: a problem as itself, anything else as a failure the server logs.
func (s *Reports) fail(ctx context.Context, w http.ResponseWriter, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		s.log.LogAttrs(ctx, slog.LevelError, "replica: a report failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(ctx), err)
}
