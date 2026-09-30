package testsupport

import (
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/objectstore"
)

// A test bucket is dated by its name, whatever the store lists it as made at: RustFS lists a bucket
// it has just made as made at the Unix epoch, which a sweep in another package's process would take
// for a bucket a killed run left, and remove under the test using it. A bucket named before its name
// said is dated by the store, unless the store cannot date it.
func TestABucketIsDatedByItsName(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	epoch := time.Unix(0, 0).UTC()
	for name, tc := range map[string]struct {
		bucket objectstore.Bucket
		at     time.Time
		ok     bool
	}{
		"just made, listed at the epoch": {objectstore.Bucket{Name: bucketPrefix + "1791000000-00ff00ff00ff00ff", Created: epoch}, time.Unix(1791000000, 0), true},
		"named before, dated":            {objectstore.Bucket{Name: bucketPrefix + "00ff00ff00ff00ff", Created: now}, now, true},
		"named before, at the epoch":     {objectstore.Bucket{Name: bucketPrefix + "00ff00ff00ff00ff", Created: epoch}, time.Time{}, false},
		"named before, undated":          {objectstore.Bucket{Name: bucketPrefix + "1234567890123456"}, time.Time{}, false},
	} {
		at, ok := made(tc.bucket)
		if ok != tc.ok || !at.Equal(tc.at) {
			t.Errorf("%s: %s, %t; want %s, %t", name, at, ok, tc.at, tc.ok)
		}
	}
}
