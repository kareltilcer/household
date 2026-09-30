package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// MaxBatch is the most mutations one batch carries (PRD 02 §9). A larger one is refused whole, 413
// batch_too_large, for the client to send in smaller ones.
const MaxBatch = 500

// ClockClamp is how far a mutation's client_time may be from the server's clock before it is held
// to it and flagged (PRD 03 §2.8, D-26).
const ClockClamp = 24 * time.Hour

// DependencyFailed is the code of a deferred mutation: an earlier mutation of its batch, to the
// row it writes or to one it names, was not applied (FR-SY6).
const DependencyFailed = "dependency_failed"

// In is one mutation of a pushed batch, the contract's SyncMutation.
type In struct {
	MutationID  uuid.UUID                  `json:"mutation_id"`
	EntityType  string                     `json:"entity_type"`
	EntityID    uuid.UUID                  `json:"entity_id"`
	Op          string                     `json:"op"`
	BaseVersion *int64                     `json:"base_version"`
	Action      *string                    `json:"action"`
	Fields      map[string]json.RawMessage `json:"fields"`
	ClientTime  *time.Time                 `json:"client_time"`
}

type batchIn struct {
	Mutations []In `json:"mutations"`
}

// BatchResult is the answer to a batch, the contract's SyncMutationBatchResult.
type BatchResult struct {
	Results []Result `json:"results"`
	Seq     int64    `json:"seq"`
}

// Config is what the push needs.
type Config struct {
	// Registry holds the modules whose entities the push writes, the platform's among them: an
	// entity whose module implements no Writer is refused.
	Registry *module.Registry
	Logger   *slog.Logger
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

// Service is the push.
type Service struct {
	registry *module.Registry
	writers  map[string]Writer
	log      *slog.Logger
	now      func() time.Time
}

// New returns the push for cfg.
func New(cfg Config) (*Service, error) {
	if cfg.Registry == nil || cfg.Logger == nil {
		return nil, errors.New("push: the push needs the module registry and a logger")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	writers := map[string]Writer{}
	for _, m := range cfg.Registry.All() {
		if w, ok := m.(Writer); ok {
			writers[m.Name()] = w
		}
	}
	return &Service{registry: cfg.Registry, writers: writers, log: cfg.Logger, now: cfg.Now}, nil
}

// Routes registers the push, which the router mounts in the household, behind the tenant
// middleware, the household's Idempotency-Key and the device's limit:
//
//	POST /households/{household_id}/sync/mutations   postSyncMutations
func (s *Service) Routes(r chi.Router) {
	r.Post("/households/{"+tenant.Param+"}/sync/mutations", s.push)
}

// push applies a batch in order, each mutation in its own transaction through the mutation spine,
// and answers every one (FR-SY6): a mutation that fails does not stop the ones after it, and one
// that writes a row an earlier mutation of the batch failed to, or names one in a field, is
// deferred. The answer is 200 whenever the batch was processed at all; each mutation's outcome is in
// the body.
func (s *Service) push(w http.ResponseWriter, r *http.Request) {
	ctx := mutation.WithVia(r.Context(), audit.ViaSync)
	requestID := reqctx.RequestID(ctx)
	var batch batchIn
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		problem.Write(w, requestID, problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
		return
	}
	if len(batch.Mutations) > MaxBatch {
		problem.Write(w, requestID, problem.New(http.StatusRequestEntityTooLarge, problem.CodeBatchTooLarge))
		return
	}
	now := s.now()
	failed := map[uuid.UUID]bool{}
	out := BatchResult{Results: make([]Result, 0, len(batch.Mutations))}
	for _, m := range batch.Mutations {
		res, seq, err := s.apply(ctx, m, now, failed)
		if err != nil {
			s.log.LogAttrs(ctx, slog.LevelError, "push: a mutation could not be answered",
				slog.String("mutation_id", m.MutationID.String()), slog.Any("error", err))
			problem.Write(w, requestID, problem.Internal())
			return
		}
		if res.Outcome != Applied && res.Outcome != Merged {
			failed[m.EntityID] = true
		}
		out.Seq = max(out.Seq, seq)
		out.Results = append(out.Results, res)
	}
	if out.Seq == 0 {
		err := tenant.InTx(ctx, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, "SELECT coalesce(max(seq), 0) FROM sync_changes WHERE household_id = $1",
				tenant.From(ctx).HouseholdID()).Scan(&out.Seq)
		})
		if err != nil {
			s.log.LogAttrs(ctx, slog.LevelError, "push: read the feed", slog.Any("error", err))
			problem.Write(w, requestID, problem.Internal())
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// apply answers one mutation, and returns the feed seq it wrote, zero for none. An error is one the
// push cannot answer the mutation for.
//
// A mutation answered before, within its answer's retention, is answered as it was, and takes no
// second effect (FR-SY5); one sent again with anything else under its id is refused. Otherwise it is
// checked in this order, the first failure answering it: its entity is one the registry holds; the
// caller may contribute to the entity's module, a caller who may not see it answered not_found as
// its REST routes are; the entity may be written offline (D-84); no earlier mutation of the batch
// failed on what it depends on, else it is deferred, and kept for its replay; its entity's policy
// admits its op; and its module writes the entity through the push. Then it is written, the client's
// clock held to ClockClamp, in mutation.Apply's transaction, with an additive series' invariant
// checked first. Every answer but deferred is kept.
func (s *Service) apply(ctx context.Context, in In, now time.Time, failed map[uuid.UUID]bool) (Result, int64, error) {
	res := Result{MutationID: in.MutationID}
	fp, err := fingerprint(in)
	if err != nil {
		return res, 0, err
	}
	var found kept
	var answered bool
	if err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		found, answered, err = lookup(ctx, tx, in.MutationID)
		return err
	}); err != nil {
		return res, 0, err
	}
	if answered {
		if string(found.fingerprint) != string(fp) {
			return reject(res, Refuse(problem.CodeValidationFailed,
				"mutation %s was sent before carrying another mutation", in.MutationID)), 0, nil
		}
		return found.result, 0, nil
	}

	e, known := s.registry.Entity(in.EntityType)
	var (
		refused *Refusal
		writer  Writer
	)
	switch {
	case !known:
		refused = Refuse(problem.CodeValidationFailed, "%q is not an entity that syncs", in.EntityType)
	default:
		if err := grant.Require(ctx, e.Module(), access.Contribute); err != nil {
			var p *problem.Problem
			if !errors.As(err, &p) {
				return res, 0, err
			}
			refused = Refuse(p.Code, "the caller may not write %s", e.Module())
		}
	}
	if refused == nil && !e.OfflineWrites {
		refused = Refuse(problem.CodeForbidden, "%s is read-only offline: it is changed online, not through the push (D-84)", e.Name)
	}
	if refused == nil && dependsOnFailed(in, failed) {
		res.Outcome = Deferred
		res.Code = ptr(DependencyFailed)
		res.Message = ptr("an earlier mutation of this batch, to what this one depends on, was not applied")
		return res, 0, nil
	}
	if refused == nil {
		refused = admits(e, Op(in.Op))
	}
	if refused == nil {
		var ok bool
		if writer, ok = s.writers[e.Module()]; !ok {
			refused = Refuse(problem.CodeValidationFailed, "%s is not written through the push", e.Name)
		}
	}
	if refused != nil {
		return s.end(ctx, fp, reject(res, refused))
	}

	m := Mutation{
		ID: in.MutationID, Entity: e, EntityID: in.EntityID, Op: Op(in.Op), BaseVersion: in.BaseVersion,
		Fields: in.Fields,
	}
	if in.Action != nil {
		m.Action = *in.Action
	}
	m.ClientTime, m.ClockFlagged = clamp(in.ClientTime, now)

	var written Written
	applied, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if err := checkInvariant(ctx, tx, e, m); err != nil {
			return mutation.Record{}, err
		}
		var err error
		if written, err = writer.WriteSync(ctx, tx, m); err != nil {
			return mutation.Record{}, err
		}
		if len(written.Record.Changes) == 0 && written.Record.Event.Module == "" {
			return mutation.Record{}, nil
		}
		// The answer is kept in the effect's own transaction: a mutation that took effect is never
		// run a second time, however its answer was lost.
		kept, err := keep(ctx, tx, fp, appliedResult(res, written))
		switch {
		case err != nil:
			return mutation.Record{}, err
		case !kept:
			return mutation.Record{}, errAnswered
		}
		return written.Record, nil
	})
	var no *Refusal
	switch {
	case errors.Is(err, errAnswered):
		return s.answered(ctx, res, fp)
	case errors.As(err, &no):
		return s.end(ctx, fp, reject(res, no))
	case err != nil:
		if no = FromDatabase(err); no != nil {
			return s.end(ctx, fp, reject(res, no))
		}
		return res, 0, err
	case applied.Seq == 0:
		// Nothing written: the state the mutation asks for is in place.
		return s.end(ctx, fp, appliedResult(res, written))
	}
	return appliedResult(res, written), applied.Seq, nil
}

// errAnswered rolls back a mutation whose answer another delivery of it kept first, while this one
// ran: that one's effect stands, and so does its answer.
var errAnswered = errors.New("push: another delivery of the mutation was answered first")

// end keeps res, the answer that ends a mutation that took no effect, and returns it; or returns
// the answer another delivery of the mutation kept first, which stands.
func (s *Service) end(ctx context.Context, fp []byte, res Result) (Result, int64, error) {
	var stored bool
	err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
		var err error
		stored, err = keep(ctx, tx, fp, res)
		return err
	})
	switch {
	case err != nil:
		return res, 0, err
	case !stored:
		return s.answered(ctx, res, fp)
	}
	return res, 0, nil
}

// answered returns the answer another delivery of res's mutation kept.
func (s *Service) answered(ctx context.Context, res Result, fp []byte) (Result, int64, error) {
	var (
		found kept
		ok    bool
	)
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		var err error
		found, ok, err = lookup(ctx, tx, res.MutationID)
		return err
	})
	switch {
	case err != nil:
		return res, 0, err
	case !ok:
		return res, 0, fmt.Errorf("push: mutation %s was answered, and its answer is not kept", res.MutationID)
	case string(found.fingerprint) != string(fp):
		return reject(res, Refuse(problem.CodeValidationFailed,
			"mutation %s was sent before carrying another mutation", res.MutationID)), 0, nil
	}
	return found.result, 0, nil
}

func appliedResult(res Result, w Written) Result {
	version := w.Version
	res.Outcome, res.Version, res.Row = Applied, &version, w.Row
	return res
}

func reject(res Result, no *Refusal) Result {
	res.Outcome = Rejected
	res.Code = ptr(string(no.Code))
	res.Message = ptr(no.Message)
	res.Row = no.Row
	return res
}

func ptr[T any](v T) *T { return &v }

// dependsOnFailed reports whether in writes a row an earlier mutation of its batch failed to, or
// names one in a field, a reference by its id.
func dependsOnFailed(in In, failed map[uuid.UUID]bool) bool {
	if failed[in.EntityID] {
		return true
	}
	for _, raw := range in.Fields {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			continue
		}
		if id, err := uuid.Parse(s); err == nil && failed[id] {
			return true
		}
	}
	return false
}

// clamp returns t held to ClockClamp of now, and whether it had to be; a mutation without a client
// time is taken as made now.
func clamp(t *time.Time, now time.Time) (time.Time, bool) {
	switch {
	case t == nil:
		return now, false
	case t.Before(now.Add(-ClockClamp)):
		return now.Add(-ClockClamp), true
	case t.After(now.Add(ClockClamp)):
		return now.Add(ClockClamp), true
	}
	return *t, false
}
