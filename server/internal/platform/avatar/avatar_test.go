package avatar

import (
	"bytes"
	"context"
	"crypto/sha256"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

// The purge of a replaced picture runs once the replacement has committed and before it is answered,
// past the request's end: a store that stops answering then holds the answer for the purge's timeout
// at most, and the picture is left to the sweep, rather than for as long as the store's client waits,
// which is for good.
func TestAPurgeTheStoreDoesNotAnswerEnds(t *testing.T) {
	stalled := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	t.Cleanup(stalled.Close)
	endpoint, err := url.Parse(stalled.URL)
	if err != nil {
		t.Fatal(err)
	}
	store, err := objectstore.New(objectstore.Config{
		Location: objectstore.Location{Endpoint: endpoint, Bucket: "stalled", AccessKey: "tester", Secret: "stalled"},
		Attempts: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	var logged bytes.Buffer
	s := &Service{store: store, log: logging.New(&logged, slog.LevelDebug), now: time.Now, purgeLimit: 200 * time.Millisecond}

	began := time.Now()
	s.Purge(t.Context(), idgen.New(), idgen.New())
	if took := time.Since(began); took > 10*time.Second {
		t.Fatalf("the purge waited %s on a store that does not answer", took)
	}
	if !strings.Contains(logged.String(), "avatar: purge a replaced picture") {
		t.Fatalf("the purge that ran out of time was not logged: %s", logged.String())
	}
}

// pictures is the avatars table as the sweep reads it, by picture id, and the batches it was asked
// about.
type pictures struct {
	users   map[uuid.UUID]uuid.UUID
	batches [][]uuid.UUID
}

func (p *pictures) Query(_ context.Context, _ string, args ...any) (pgx.Rows, error) {
	ids, _ := args[0].([]uuid.UUID)
	p.batches = append(p.batches, slices.Clone(ids))
	rows := &pictureRows{}
	for _, id := range ids {
		if user, ok := p.users[id]; ok {
			rows.rows = append(rows.rows, [2]uuid.UUID{user, id})
		}
	}
	return rows, nil
}

// pictureRows are the rows of the avatars table a query found, read as pgx.ForEachRow reads them: the
// embedded Rows, nil, stands in for what it does not call.
type pictureRows struct {
	pgx.Rows
	rows [][2]uuid.UUID
	next int
}

func (r *pictureRows) Close()                        {}
func (r *pictureRows) Err() error                    { return nil }
func (r *pictureRows) CommandTag() pgconn.CommandTag { return pgconn.NewCommandTag("SELECT") }

func (r *pictureRows) Next() bool {
	r.next++
	return r.next <= len(r.rows)
}

func (r *pictureRows) Scan(dest ...any) error {
	row := r.rows[r.next-1]
	*dest[0].(*uuid.UUID), *dest[1].(*uuid.UUID) = row[0], row[1]
	return nil
}

// The sweep asks the table about the old pictures a batch at a time as it lists them, rather than
// about all of them at once, nearly every picture being older than a day: a picture a user has stays
// whichever batch it falls in, and one nobody has goes, the last batch's too.
func TestTheSweepAsksAboutPicturesABatchAtATime(t *testing.T) {
	defer func(n int) { sweepBatch = n }(sweepBatch)
	sweepBatch = 2
	store := testsupport.ObjectStore(t)
	table := &pictures{users: map[uuid.UUID]uuid.UUID{}}
	var kept, gone []string
	for i := range 5 {
		user, id := idgen.New(), idgen.New()
		key := Key(user, id)
		body := []byte(key)
		if err := store.PutOnce(t.Context(), key, bytes.NewReader(body), int64(len(body)),
			objectstore.Object{ContentType: "image/png", SHA256: sha256.Sum256(body)}); err != nil {
			t.Fatal(err)
		}
		if i%2 == 0 {
			table.users[id] = user
			kept = append(kept, key)
		} else {
			gone = append(gone, key)
		}
	}
	later := func() time.Time { return time.Now().Add(25 * time.Hour) }
	s := &Service{store: store, log: logging.New(io.Discard, slog.LevelDebug), now: later}

	n, err := s.Sweep(t.Context(), table)
	if err != nil || n != len(gone) {
		t.Fatalf("swept %d, %v; want %d", n, err, len(gone))
	}
	if len(table.batches) != 3 || len(table.batches[0]) != 2 || len(table.batches[2]) != 1 {
		t.Fatalf("asked about %v", table.batches)
	}
	var left []string
	if err := store.List(t.Context(), "u/", func(o objectstore.Info) error {
		left = append(left, o.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	slices.Sort(kept)
	if !slices.Equal(left, kept) {
		t.Fatalf("left %v, want %v", left, kept)
	}
}
