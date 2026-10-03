package storage_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/storage"
	"github.com/kareltilcer/household/server/internal/platform/vectors"
)

// The shared vectors, run against the server's twin of @household/domain's storage arithmetic
// (D-37): the average, the blocks it needs, what they cost and the month's projection.
func TestStorageVectors(t *testing.T) {
	a := storage.Default
	vectors.Run(t, "storage", map[string]vectors.Subject{
		"average": func(in json.RawMessage) (any, error) {
			samples, err := vectors.Decode[[]int64](in)
			if err != nil {
				return nil, err
			}
			return storage.Average(samples), nil
		},
		"blocks": func(in json.RawMessage) (any, error) {
			average, err := vectors.Decode[int64](in)
			if err != nil {
				return nil, err
			}
			return a.Blocks(average), nil
		},
		"charge": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				AverageBytes    int64 `json:"average_bytes"`
				UnitAmountMinor int64 `json:"unit_amount_minor"`
			}](in)
			if err != nil {
				return nil, err
			}
			blocks := a.Blocks(v.AverageBytes)
			return map[string]int64{"blocks": int64(blocks), "amount_minor": int64(blocks) * v.UnitAmountMinor}, nil
		},
		"projected": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Samples   []int64 `json:"samples"`
				Current   int64   `json:"current"`
				Remaining int     `json:"remaining"`
			}](in)
			if err != nil {
				return nil, err
			}
			return storage.Projected(v.Samples, v.Current, v.Remaining), nil
		},
	}, func(error) string { return "" })
}

// The allowance is PRD 04 §4's: 205 GB in all, and the blocks in effect are added to the base.
func TestTheAllowance(t *testing.T) {
	a := storage.Default
	if got := a.Ceiling(); got != 205*storage.GB {
		t.Fatalf("ceiling %d, want 205 GB", got)
	}
	if got := a.Included(2); got != 25*storage.GB {
		t.Fatalf("included with 2 blocks %d, want 25 GB", got)
	}
	if got := a.Standing(storage.Usage{Current: 19 * storage.GB, Average: 18 * storage.GB}); got != (storage.Standing{
		Used: 19 * storage.GB, Included: 25 * storage.GB, Blocks: 2,
	}) {
		t.Fatalf("standing %+v", got)
	}
	if got := storage.Projected([]int64{4, 6}, 100, -3); got != 5 {
		t.Fatalf("projected over days that cannot be left %d, want 5", got)
	}
}

// A month is the calendar month, UTC's, whatever the offset of the instant asked of.
func TestAMonthIsUTCs(t *testing.T) {
	prague := time.FixedZone("CEST", 2*60*60)
	from, to := storage.Month(time.Date(2026, 10, 1, 1, 30, 0, 0, prague))
	if !from.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)) || !to.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("month %s to %s, want September", from, to)
	}
	from, to = storage.Month(time.Date(2026, 12, 31, 23, 59, 0, 0, time.UTC))
	if !from.Equal(time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)) || !to.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("month %s to %s, want December", from, to)
	}
}
