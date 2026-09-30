package testsupport

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
)

// ObjectStoreURLEnv names the variable that points the tests at the object store, a URL with its
// credentials and no bucket, since each test makes its own. CI sets it for its service container;
// locally it is optional.
const ObjectStoreURLEnv = "HOUSEHOLD_TEST_OBJECT_STORE_URL"

// DefaultObjectStoreURL is the objectstore service in docker-compose.yml, with the credentials it is
// started with.
const DefaultObjectStoreURL = "http://household:household-local-only@127.0.0.1:9000"

// bucketPrefix starts the name of every bucket a test makes.
const bucketPrefix = "test-"

// ObjectStoreLocation returns the test object store's location with bucket as its bucket.
func ObjectStoreLocation(t testing.TB, bucket string) objectstore.Location {
	t.Helper()
	raw := os.Getenv(ObjectStoreURLEnv)
	if raw == "" {
		raw = DefaultObjectStoreURL
	}
	loc, err := objectstore.ParseURL(strings.TrimSuffix(raw, "/") + "/" + bucket)
	if err != nil {
		t.Fatalf("%s: %v", ObjectStoreURLEnv, err)
	}
	return loc
}

// swept is the first bucket sweep of the process: the buckets a killed run left, older than
// staleAfter, are removed once.
var swept sync.Once

// ObjectStore returns a bucket of t's own on the test object store, which is removed, with every
// object in it, when t ends. A store that cannot be reached fails t rather than skipping it, as a
// database that cannot does (Connect).
func ObjectStore(t testing.TB) *objectstore.Store {
	t.Helper()
	var suffix [8]byte
	_, _ = rand.Read(suffix[:])
	store := objectStore(t, bucketPrefix+hex.EncodeToString(suffix[:]))
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := store.CreateBucket(ctx); err != nil {
		t.Fatalf("create a bucket on the test object store (start it with `pnpm run up`, or set %s): %v", ObjectStoreURLEnv, err)
	}
	swept.Do(func() { sweepBuckets(ctx, t, store) })
	t.Cleanup(func() {
		// t.Context() is already cancelled when cleanups run.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := store.RemoveBucket(ctx); err != nil {
			t.Logf("remove the test bucket %s: %v", store.Bucket(), err)
		}
	})
	return store
}

func objectStore(t testing.TB, bucket string) *objectstore.Store {
	t.Helper()
	store, err := objectstore.New(objectstore.Config{Location: ObjectStoreLocation(t, bucket)})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

// sweepBuckets removes the test buckets older than staleAfter, which a run that was killed before
// its cleanups ran left behind. A failure is logged, not fatal: the sweep tidies, and tests nothing.
func sweepBuckets(ctx context.Context, t testing.TB, store *objectstore.Store) {
	buckets, err := store.Buckets(ctx)
	if err != nil {
		t.Logf("sweep the test buckets: %v", err)
		return
	}
	for _, b := range buckets {
		if !strings.HasPrefix(b.Name, bucketPrefix) || time.Since(b.Created) < staleAfter {
			continue
		}
		if err := objectStore(t, b.Name).RemoveBucket(ctx); err != nil {
			t.Logf("sweep the test bucket %s: %v", b.Name, err)
		}
	}
}
