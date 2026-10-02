package fairuse_test

import (
	"net/http"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/fairuse"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// The owners are warned at 80 % of a ceiling, once, as the count crosses it upwards.
func TestTheWarningIsAtEightyPercent(t *testing.T) {
	for _, tc := range []struct {
		count, ceiling int64
		warns          bool
	}{
		{9, 12, false}, {10, 12, true}, {12, 12, true},
		{199_999, fairuse.Rows, false}, {200_000, fairuse.Rows, true},
		{79_999, fairuse.Objects, false}, {80_000, fairuse.Objects, true},
	} {
		if got := fairuse.Warns(tc.count, tc.ceiling); got != tc.warns {
			t.Errorf("%d of %d warns: %v", tc.count, tc.ceiling, got)
		}
	}
	if !fairuse.Crossed(9, 10, 12) || fairuse.Crossed(10, 11, 12) || fairuse.Crossed(11, 9, 12) || fairuse.Crossed(0, 9, 12) {
		t.Fatal("crossing 80 % is going from below it to at or above it")
	}
}

// A count ceiling refuses with 403 (D-116), naming the resource, its ceiling and, for rows, the module.
func TestARefusalNamesWhatItCounts(t *testing.T) {
	p := fairuse.Refusal(fairuse.ResourceRows, fairuse.Rows, "shopping")
	if p.Status != http.StatusForbidden || p.Code != problem.CodeFairUseCeiling ||
		p.Extensions["resource"] != "rows" || p.Extensions["ceiling"] != int64(fairuse.Rows) || p.Extensions["module"] != "shopping" {
		t.Fatalf("%+v", p)
	}
	if p := fairuse.Refusal(fairuse.ResourceObjects, fairuse.Objects, ""); p.Extensions["module"] != nil {
		t.Fatalf("objects name a module: %+v", p)
	}
	if p := fairuse.HouseholdLimit(); p.Status != http.StatusForbidden || p.Code != problem.CodeHouseholdLimitReached {
		t.Fatalf("%+v", p)
	}
}
