// Package files is the platform's upload pipeline (PRD 03 §8, PRD 01 §8; plan item 14, ADR 0015):
// what every module that keeps a household's files goes through, from the request that carries the
// bytes to the link that fetches them.
//
// An upload goes through the API, never straight to the store (FR-FL1). A module's handler, once it
// has authorised the caller:
//
//  1. Receives the file: the multipart body is read to a temporary file, under the size cap, its
//     SHA-256 computed and its type sniffed from its bytes, and a type the route does not take, or a
//     program, is refused (Receive).
//  2. Puts it: the household's storage ceiling is checked, and the bytes are written to the store,
//     once, under the key of the entity's original, h/{household}/{module}/{entity}/original (Put).
//  3. Records it, in the transaction of the mutation that records the upload, with its audit event
//     and its change: the metadata row, the attribution FR-ST1 needs, and the job that derives its
//     variants after the commit (Record).
//
// A link to an object is a URL pre-signed for that one object, valid for minutes, and issued only
// once the caller is authorised for the entity (Link, D-9). Variants, a thumbnail, a preview, a
// document's PDF, are derived after the commit, once, and kept forever, since the bytes never change
// (FR-FL3); the workers that derive them, and purge the objects of a deleted entity, run in every
// instance, woken by the commits of their own instance and looking for the others' every so often
// (Run). Bytes no row records, which an upload whose mutation failed leaves, are swept once they are
// a day old (Sweep).
package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/convert"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// MaxBytes is the individual file ceiling (PRD 04 §5): 100 MB. A larger file is refused 413.
const MaxBytes int64 = 100_000_000

// The variants of an entity's objects: the original as uploaded, and what is derived from it.
const (
	Original  = "original"
	Thumbnail = "thumbnail"
	Preview   = "preview"
	PDF       = "pdf"
)

// Key is the object key of an entity's variant (PRD 01 §8): the household first, so that a bucket
// policy, a lifecycle rule, a usage listing and a household's erasure are each a prefix.
func Key(household uuid.UUID, module string, entity uuid.UUID, variant string) string {
	return fmt.Sprintf("h/%s/%s/%s/%s", household, module, entity, variant)
}

// Querier reads across households: the meter role's pool (PRD 01 §2.3).
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Config is what the pipeline needs.
type Config struct {
	// Pool opens the transactions the workers run in, each in one household's context, as the
	// request role.
	Pool tenant.Beginner
	// Meter finds the households with work due, as the meter role, which reads across households
	// and only the columns that schedule it.
	Meter Querier
	Store *objectstore.Store
	// Convert is the converter sidecar, nil for none: an office document's or a PDF's variants then
	// fail, and it stays download-only.
	Convert *convert.Client
	Log     *slog.Logger
	// Dir is where uploads are read to before they are stored, a directory of the system's
	// temporary one when "".
	Dir string
	// Timeout is how long an upload's body may take to arrive, 15 minutes when zero: a 100 MB file on
	// a slow connection takes several.
	Timeout time.Duration
	// MaxBytes caps a file, MaxBytes when zero.
	MaxBytes int64
	// Allowance is what a household may store, storage.Default when zero.
	Allowance storage.Allowance
	// Now is the clock, time.Now when nil.
	Now func() time.Time
	// Workers is how many jobs run at once in the instance, 2 when zero, and Poll how often they look
	// for jobs other instances' commits left, 30 seconds when zero.
	Workers int
	Poll    time.Duration
	// Lease is how long a worker holds a job it takes, and so how long the job may run, 10 minutes
	// when zero: past it another worker may take the job, as one whose worker died.
	Lease time.Duration
	// Turn is how long a worker goes on taking one household's jobs, 10 seconds when zero: once it is
	// over, and the job running then has ended, the worker lets the household go, and the other
	// households due take their turns before it takes more (Run).
	Turn time.Duration
}

// Service is the pipeline.
type Service struct {
	pool      tenant.Beginner
	meter     Querier
	store     *objectstore.Store
	convert   *convert.Client
	log       *slog.Logger
	dir       string
	timeout   time.Duration
	maxBytes  int64
	allowance storage.Allowance
	now       func() time.Time
	workers   int
	poll      time.Duration
	lease     time.Duration
	turn      time.Duration

	wake chan struct{}
	mu   sync.Mutex
	// busy holds the households a worker of this instance is draining, each true once it was found
	// due again meanwhile (hold).
	busy map[uuid.UUID]bool
}

// staleUploads is how old a file in Dir must be before New takes it for one a process that died
// left behind.
const staleUploads = 24 * time.Hour

// New returns the pipeline cfg describes, and removes what a process that died left in its
// directory.
func New(cfg Config) (*Service, error) {
	if cfg.Pool == nil || cfg.Meter == nil || cfg.Store == nil || cfg.Log == nil {
		return nil, errors.New("files: the pipeline needs a pool, the meter, a store and a logger")
	}
	s := &Service{
		pool: cfg.Pool, meter: cfg.Meter, store: cfg.Store, convert: cfg.Convert, log: cfg.Log,
		dir: cfg.Dir, timeout: cfg.Timeout, maxBytes: cfg.MaxBytes, allowance: cfg.Allowance,
		now: cfg.Now, workers: cfg.Workers, poll: cfg.Poll, lease: cfg.Lease, turn: cfg.Turn,
		wake: make(chan struct{}, 1), busy: map[uuid.UUID]bool{},
	}
	if s.dir == "" {
		s.dir = filepath.Join(os.TempDir(), "household-uploads")
	}
	if s.timeout <= 0 {
		s.timeout = 15 * time.Minute
	}
	if s.maxBytes <= 0 {
		s.maxBytes = MaxBytes
	}
	if s.allowance == (storage.Allowance{}) {
		s.allowance = storage.Default
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.workers <= 0 {
		s.workers = 2
	}
	if s.poll <= 0 {
		s.poll = 30 * time.Second
	}
	if s.lease <= 0 {
		s.lease = lease
	}
	if s.turn <= 0 {
		s.turn = 10 * time.Second
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return nil, fmt.Errorf("files: the upload directory: %w", err)
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("files: the upload directory: %w", err)
	}
	for _, e := range entries {
		info, err := e.Info()
		if err == nil && strings.HasPrefix(e.Name(), spoolPrefix) && s.now().Sub(info.ModTime()) > staleUploads {
			_ = os.Remove(filepath.Join(s.dir, e.Name()))
		}
	}
	return s, nil
}

// Store is the object store the pipeline writes.
func (s *Service) Store() *objectstore.Store { return s.store }

// Nudge wakes the workers: a mutation that recorded an upload or a deletion calls it once it has
// committed, so that its job runs now rather than at the next poll.
func (s *Service) Nudge() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// system returns ctx carrying household's scope with no caller: the workers' and the sweep's, which
// act for no member.
func (s *Service) system(ctx context.Context, household uuid.UUID) context.Context {
	return tenant.Assume(ctx, s.pool, household, uuid.Nil, "")
}
