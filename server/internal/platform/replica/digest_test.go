package replica_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/zeebo/xxh3"

	"github.com/kareltilcer/household/server/internal/platform/replica"
	"github.com/kareltilcer/household/server/internal/platform/vectors"
)

type pair struct {
	EntityID uuid.UUID `json:"entity_id"`
	Version  int64     `json:"version"`
}

// The report's hashes are the shared vectors' (D-37): xxh3-64 itself, each row's pair and an entity
// type's entry, which @household/sync computes in a replica as the server does here.
func TestTheReportsHashesAreTheVectors(t *testing.T) {
	vectors.Run(t, "replica-digest", map[string]vectors.Subject{
		"xxh3": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Text string `json:"text"`
			}](in)
			return fmt.Sprintf("%016x", xxh3.HashString(v.Text)), err
		},
		"pair": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[pair](in)
			return fmt.Sprintf("%016x", replica.PairHash(v.EntityID, v.Version)), err
		},
		"entry": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Pairs []pair `json:"pairs"`
			}](in)
			var d replica.Digest
			for _, p := range v.Pairs {
				d.Add(p.EntityID, p.Version)
			}
			return map[string]any{"hash": d.Hex(), "count": d.Count}, err
		},
	}, func(err error) string { return err.Error() })
}
