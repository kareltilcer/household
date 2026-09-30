// Package health serves the liveness and readiness probes (getHealthz, getReadyz).
// Liveness says the process answers; readiness says whether it can serve, by checking the
// dependencies a request needs. Item 2 checks the database; item 14 adds the object store, which
// the API serves without (FR-NF3), so that its absence degrades the answer rather than failing it.
package health

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/httpx"
)

// Check is one dependency readiness probes.
type Check struct {
	// Name keys the check in the readiness response.
	Name string
	// Probe returns nil when the dependency can serve.
	Probe func(context.Context) error
	// Optional marks a dependency the API serves without: its failure makes the answer degraded,
	// still 200, rather than down, so that a load balancer keeps sending the instance what it can
	// serve. Every instance shares such a dependency, and taking them all out of rotation over it
	// would turn the one feature it serves into an outage of all the others.
	Optional bool
}

// Health answers the probes.
type Health struct {
	log     *slog.Logger
	timeout time.Duration
	checks  []Check
}

// New returns the probes, giving each readiness check timeout to answer.
func New(log *slog.Logger, timeout time.Duration, checks ...Check) *Health {
	return &Health{log: log, timeout: timeout, checks: checks}
}

// The status values of the contract's Readiness schema. `degraded` is an instance that serves
// without an optional dependency (Check.Optional).
const (
	statusOK       = "ok"
	statusDegraded = "degraded"
	statusDown     = "down"
)

// Readiness is the contract's Readiness schema.
type Readiness struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// Liveness answers 200 while the process can answer at all. It checks nothing else: a
// liveness probe that fails when the database does gets every instance restarted by an
// outage none of them caused.
func (h *Health) Liveness(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": statusOK})
}

// Readiness runs every check at once and answers 200 when all pass, 503 when any that is not
// optional fails, and 200 degraded when only optional ones do, naming each check's outcome. A
// failed check is logged with its error.
func (h *Health) Readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	results := make([]error, len(h.checks))
	var wg sync.WaitGroup
	for i, c := range h.checks {
		wg.Go(func() { results[i] = c.Probe(ctx) })
	}
	wg.Wait()

	body := Readiness{Status: statusOK, Checks: make(map[string]string, len(h.checks))}
	for i, c := range h.checks {
		if err := results[i]; err != nil {
			switch {
			case !c.Optional:
				body.Status = statusDown
			case body.Status == statusOK:
				body.Status = statusDegraded
			}
			body.Checks[c.Name] = statusDown
			h.log.LogAttrs(r.Context(), slog.LevelWarn, "readiness check failed",
				slog.String("check", c.Name), slog.Any("error", err))
			continue
		}
		body.Checks[c.Name] = statusOK
	}
	status := http.StatusOK
	if body.Status == statusDown {
		status = http.StatusServiceUnavailable
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, status, body)
}

// Pinger is what the database check needs of a pool.
type Pinger interface {
	Ping(context.Context) error
}

// Database is the readiness check for the PostgreSQL pool.
func Database(pool Pinger) Check {
	return Check{Name: "database", Probe: pool.Ping}
}

// Bucket is what the object store's check needs of a store: whether its bucket answers.
type Bucket interface {
	Check(context.Context) error
}

// ObjectStore is the readiness check for the object store the files pipeline keeps households'
// files and users' pictures in (item 14). It is optional: without the store an upload answers 502
// storage_unavailable, and everything else, the links to what is already stored among it, still
// serves (FR-NF3).
func ObjectStore(store Bucket) Check {
	return Check{Name: "object_store", Probe: store.Check, Optional: true}
}
