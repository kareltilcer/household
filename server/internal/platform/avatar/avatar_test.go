package avatar

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/logging"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
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
