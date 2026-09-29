// Package ratelimit holds the limits of PRD 02 §9: every one answers 429 rate_limited with a
// Retry-After, and is per user and per household, so that one tenant cannot degrade another.
//
// Two kinds, kept in two places. A throttle guards a surface that takes a password or an address,
// signing in, registering, a reset, a resend: few requests, each one worth an attacker's while,
// so its counts are kept in PostgreSQL (auth_throttles), where every instance of the server
// shares them and a restart forgets nothing. A bucket bounds the API a signed-in user or a
// household calls: every request counts, so its tokens are kept in memory, per instance, where a
// request costs no write (ADR 0009).
package ratelimit

import (
	"bytes"
	"context"
	"crypto/sha256"
	"math"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
)

// Refusal is the 429 rate_limited problem for a request that may be tried again after retry,
// which its Retry-After gives in whole seconds, rounded up, and at least one.
func Refusal(retry time.Duration) *problem.Problem {
	seconds := max(int(math.Ceil(retry.Seconds())), 1)
	p := problem.New(http.StatusTooManyRequests, problem.CodeRateLimited)
	p.Header = http.Header{"Retry-After": {strconv.Itoa(seconds)}}
	return p
}

// Limit is a throttle on one surface: at most Max attempts per subject in Window.
type Limit struct {
	// Name is the surface, part of every key the limit counts under.
	Name   string
	Max    int
	Window time.Duration
	// Backoff, when set, makes the Max-th failure in a window block the subject for Backoff,
	// and each failure after it for twice as long as the last, up to MaxBackoff: a cooldown that
	// lengthens while the failures go on, rather than a lockout (FR-ID3). The count starts again
	// once the subject has been quiet for Window after its block ended.
	Backoff, MaxBackoff time.Duration
}

// The throttles of PRD 02 §9. An account's is counted by the address it is asked for, whether or
// not an account has it, so that a refusal says nothing about which addresses do (D-13); a
// client's by its network (clientip.Network).
var (
	LoginAccount    = Limit{Name: "login.account", Max: 10, Window: 15 * time.Minute, Backoff: time.Minute, MaxBackoff: time.Hour}
	LoginNetwork    = Limit{Name: "login.network", Max: 60, Window: 15 * time.Minute}
	RegisterNetwork = Limit{Name: "register.network", Max: 5, Window: time.Hour}
	// The note a registration sends an address that has an account goes out at most three times
	// an hour, however many networks ask; a registration past it still answers 202 (D-96).
	RegisterNote = Limit{Name: "register.note", Max: 3, Window: time.Hour}
	ResetAccount = Limit{Name: "password_reset.account", Max: 3, Window: time.Hour}
	// A verification email is sent again at most once a minute and five times an hour (D-96).
	ResendMinute = Limit{Name: "verify_resend.minute", Max: 1, Window: time.Minute}
	ResendHour   = Limit{Name: "verify_resend.hour", Max: 5, Window: time.Hour}
	// A client's network asks for at most twenty resets and twenty resends an hour, whichever
	// addresses it names (D-96): each queues a lookup, and counted by the address alone, one client
	// naming a new address each time would fill the queue every email waits in.
	ResetNetwork  = Limit{Name: "password_reset.network", Max: 20, Window: time.Hour}
	ResendNetwork = Limit{Name: "verify_resend.network", Max: 20, Window: time.Hour}
	// An account's second step takes five wrong codes in five minutes, counted by the account,
	// which bounds every challenge it has and the first code that turns it on (D-101); the tenth
	// since the last right one locks it (identity.LockAfter).
	MFAAccount = Limit{Name: "mfa.account", Max: 5, Window: 5 * time.Minute}
	// A client's network begins sixty sign-ins with a provider an hour (D-101): each writes a row
	// that waits ten minutes for its callback.
	OAuthStartNetwork = Limit{Name: "oauth_start.network", Max: 60, Window: time.Hour}
)

// Beginner opens transactions.
type Beginner interface {
	BeginTx(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error)
}

// Throttles counts attempts in auth_throttles.
type Throttles struct {
	pool Beginner
	now  func() time.Time
}

// NewThrottles returns throttles counting in pool's database; now is the clock, time.Now when nil.
func NewThrottles(pool Beginner, now func() time.Time) *Throttles {
	if now == nil {
		now = time.Now
	}
	return &Throttles{pool: pool, now: now}
}

// key is where l counts subject: the SHA-256 of the two, so that no address is kept in the clear.
// It is not keyed, so it hides an address only from someone who does not guess it: a row is still
// personal data.
func key(l Limit, subject string) []byte {
	sum := sha256.Sum256([]byte(l.Name + "\x00" + subject))
	return sum[:]
}

// state is a subject's row.
type state struct {
	count        int
	windowEnds   time.Time
	blockedUntil time.Time
}

// wait is how long s makes subject wait at now under l: while blocked, for a limit that backs off,
// and while the window's Max is used up, for one that does not.
func (l Limit) wait(s state, now time.Time) time.Duration {
	if l.Backoff > 0 {
		return max(s.blockedUntil.Sub(now), 0)
	}
	if s.count >= l.Max && now.Before(s.windowEnds) {
		return s.windowEnds.Sub(now)
	}
	return 0
}

// fail is s after a failed attempt at now.
func (l Limit) fail(s state, now time.Time) state {
	quiet := !now.Before(s.windowEnds) && (s.blockedUntil.IsZero() || !now.Before(s.blockedUntil.Add(l.Window)))
	if quiet {
		s = state{windowEnds: now.Add(l.Window)}
	}
	s.count++
	if l.Backoff > 0 && s.count >= l.Max {
		// Doubled only while the double stays within MaxBackoff, which also keeps the shift from
		// overflowing: a minute doubled 28 times is past what a Duration holds.
		block := l.MaxBackoff
		if doublings := s.count - l.Max; l.Backoff <= l.MaxBackoff>>doublings {
			block = l.Backoff << doublings
		}
		s.blockedUntil = now.Add(block)
	}
	return s
}

// Take counts an attempt by each subject under its limit, and refuses it, counting nothing and
// returning the longest wait, when any subject has made its limit's Max in the current window.
func (t *Throttles) Take(ctx context.Context, counts ...Count) (time.Duration, error) {
	return t.update(ctx, counts, func(l Limit, s state, now time.Time) (state, time.Duration) {
		if !now.Before(s.windowEnds) {
			s = state{windowEnds: now.Add(l.Window)}
		}
		if s.count >= l.Max {
			return s, max(s.windowEnds.Sub(now), time.Second)
		}
		s.count++
		return s, 0
	})
}

// Count is a subject as a limit counts it.
type Count struct {
	Limit   Limit
	Subject string
}

// Attempt counts an attempt by each subject under its limit as a failure, before the attempt is
// checked, and refuses it, counting nothing and returning the longest wait, when any of them must
// wait. Counting first is what holds attempts sent at once to their limits: counted only once each
// had failed, every one of them would find the counts as they were before any. An attempt that
// then succeeds is taken back, by Clear or Refund.
func (t *Throttles) Attempt(ctx context.Context, counts ...Count) (time.Duration, error) {
	return t.update(ctx, counts, func(l Limit, s state, now time.Time) (state, time.Duration) {
		if wait := l.wait(s, now); wait > 0 {
			return s, wait
		}
		return l.fail(s, now), 0
	})
}

// Refund takes back one attempt Attempt counted against subject under l, which succeeded: a limit
// that counts failures alone, and does not back off, is left as though it had not been made.
func (t *Throttles) Refund(ctx context.Context, l Limit, subject string) error {
	return pgx.BeginTxFunc(ctx, t.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "UPDATE auth_throttles SET count = count - 1 WHERE key = $1 AND count > 0", key(l, subject))
		return err
	})
}

// Clear forgets subject's attempts under l, after it succeeded.
func (t *Throttles) Clear(ctx context.Context, l Limit, subject string) error {
	return pgx.BeginTxFunc(ctx, t.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "DELETE FROM auth_throttles WHERE key = $1", key(l, subject))
		return err
	})
}

// update applies step to each of counts' rows, under a row lock, in one transaction, and writes
// what it returns for each when it admits the attempt on all of them; when any refuses, update
// changes no count and returns the longest wait they give. A refusal the rows already give is
// found before any row is locked or made, so that an attempt refused anyway writes nothing, and a
// client past one of its limits adds no row for each new subject it names; only a refusal that
// an attempt running beside it brought about leaves the empty rows made for subjects not seen
// before.
func (t *Throttles) update(ctx context.Context, counts []Count, step func(Limit, state, time.Time) (state, time.Duration)) (time.Duration, error) {
	type row struct {
		limit Limit
		key   []byte
		next  state
	}
	rows := make([]row, 0, len(counts))
	keys := make([][]byte, 0, len(counts))
	for _, c := range counts {
		k := key(c.Limit, c.Subject)
		rows = append(rows, row{limit: c.Limit, key: k})
		keys = append(keys, k)
	}
	// Locked in the order of their keys, whichever attempt asks, so that two attempts counting the
	// same rows never wait on each other in a cycle.
	slices.SortFunc(rows, func(a, b row) int { return bytes.Compare(a.key, b.key) })
	var wait time.Duration
	err := pgx.BeginTxFunc(ctx, t.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		wait = 0
		now := t.now()
		// The rows as they stand, unlocked. A subject with none has an ended window, which no limit
		// refuses; the rows read again under their locks, below, decide an attempt they admit.
		standing, err := read(ctx, tx, keys)
		if err != nil {
			return err
		}
		for _, r := range rows {
			if s, ok := standing[string(r.key)]; ok {
				_, refused := step(r.limit, s, now)
				wait = max(wait, refused)
			}
		}
		if wait > 0 {
			return nil
		}
		for i := range rows {
			r := &rows[i]
			// The row made, or the one there locked, in one statement: a subject with no row has an
			// ended window, which the step starts afresh. Made and then read apart, a row a Clear
			// deleted in between would be gone by the read, and the attempt would fail.
			var (
				s       state
				blocked *time.Time
			)
			if err := tx.QueryRow(ctx, `
				INSERT INTO auth_throttles (key, count, window_ends_at) VALUES ($1, 0, $2)
				ON CONFLICT (key) DO UPDATE SET count = auth_throttles.count
				RETURNING count, window_ends_at, blocked_until`,
				r.key, now).Scan(&s.count, &s.windowEnds, &blocked); err != nil {
				return err
			}
			if blocked != nil {
				s.blockedUntil = *blocked
			}
			var refused time.Duration
			r.next, refused = step(r.limit, s, now)
			wait = max(wait, refused)
		}
		if wait > 0 {
			return nil
		}
		for _, r := range rows {
			var blockedUntil *time.Time
			if !r.next.blockedUntil.IsZero() {
				blockedUntil = &r.next.blockedUntil
			}
			if _, err := tx.Exec(ctx,
				"UPDATE auth_throttles SET count = $2, window_ends_at = $3, blocked_until = $4 WHERE key = $1",
				r.key, r.next.count, r.next.windowEnds, blockedUntil); err != nil {
				return err
			}
		}
		return nil
	})
	return wait, err
}

// read returns the rows of keys that exist, by key, as they stand, without locking them.
func read(ctx context.Context, tx pgx.Tx, keys [][]byte) (map[string]state, error) {
	rows, err := tx.Query(ctx, "SELECT key, count, window_ends_at, blocked_until FROM auth_throttles WHERE key = ANY($1)", keys)
	if err != nil {
		return nil, err
	}
	out := make(map[string]state, len(keys))
	var (
		k       []byte
		s       state
		blocked *time.Time
	)
	_, err = pgx.ForEachRow(rows, []any{&k, &s.count, &s.windowEnds, &blocked}, func() error {
		row := state{count: s.count, windowEnds: s.windowEnds}
		if blocked != nil {
			row.blockedUntil = *blocked
		}
		out[string(k)] = row
		return nil
	})
	return out, err
}

// Rate is a bucket's size and how fast it refills.
type Rate struct {
	PerMinute float64
	Burst     float64
}

// The API limits of PRD 02 §9: a signed-in user's, and a household's, which its members share
// (D-96).
var (
	PerUser      = Rate{PerMinute: 600, Burst: 100}
	PerHousehold = Rate{PerMinute: 3000, Burst: 500}
)

// Buckets are token buckets, one per key, held in memory.
type Buckets struct {
	rate Rate
	now  func() time.Time

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastSweep time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

// NewBuckets returns buckets filling at rate; now is the clock, time.Now when nil.
func NewBuckets(rate Rate, now func() time.Time) *Buckets {
	if now == nil {
		now = time.Now
	}
	return &Buckets{rate: rate, now: now, buckets: map[string]*bucket{}}
}

// perSecond is how many tokens a bucket gains in a second.
func (b *Buckets) perSecond() float64 { return b.rate.PerMinute / 60 }

// Take takes a token from key's bucket, and returns how long until it holds one, zero when it
// did. A new key's bucket starts full.
func (b *Buckets) Take(key string) time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.sweep(now)
	k, ok := b.buckets[key]
	if !ok {
		k = &bucket{tokens: b.rate.Burst, at: now}
		b.buckets[key] = k
	}
	k.tokens = min(k.tokens+now.Sub(k.at).Seconds()*b.perSecond(), b.rate.Burst)
	k.at = now
	if k.tokens >= 1 {
		k.tokens--
		return 0
	}
	// Rounded up, and never zero, which is a token taken: a bucket a nanosecond short of its next
	// token waits a fraction of one, which truncating would make none.
	return max(time.Duration(math.Ceil((1-k.tokens)/b.perSecond()*float64(time.Second))), 1)
}

// sweep drops, at most once a minute, the buckets that have filled up again: a full bucket is what
// a new one starts as, so dropping it changes nothing but the memory it held.
func (b *Buckets) sweep(now time.Time) {
	if now.Sub(b.lastSweep) < time.Minute {
		return
	}
	b.lastSweep = now
	full := time.Duration(b.rate.Burst / b.perSecond() * float64(time.Second))
	for key, k := range b.buckets {
		if now.Sub(k.at) >= full {
			delete(b.buckets, key)
		}
	}
}

// Middleware refuses a request with 429 when its bucket is empty. key names the request's bucket,
// and false for a request the limit does not count, which passes.
func Middleware(b *Buckets, key func(*http.Request) (string, bool)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if k, ok := key(r); ok {
				if wait := b.Take(k); wait > 0 {
					problem.Write(w, reqctx.RequestID(r.Context()), Refusal(wait))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
