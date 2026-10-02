package sync_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/sync"
)

func TestCheckRefusesAChangeItsEntityDoesNotAdmit(t *testing.T) {
	id, member := uuid.MustParse("01900000-0000-7000-8000-0000000000c1"), uuid.MustParse("01900000-0000-7000-8000-0000000000b1")
	shared := sync.Entity{Name: "tasks.card", Access: sync.Grant}
	owned := sync.Entity{Name: "calendar.event", Access: sync.Grant | sync.Owner | sync.Audience}
	for name, tc := range map[string]struct {
		entity sync.Entity
		change sync.Change
		want   string
	}{
		"an upsert":            {shared, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: "row"}, ""},
		"a delete":             {shared, sync.Change{ID: id, Op: sync.Delete, Version: 2}, ""},
		"a private row":        {owned, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: "row", Visibility: sync.Private, Owner: member}, ""},
		"an op of its own":     {shared, sync.Change{ID: id, Op: "retract", Version: 1}, `op "retract"`},
		"no id":                {shared, sync.Change{Op: sync.Delete, Version: 2}, "no entity id"},
		"no version":           {shared, sync.Change{ID: id, Op: sync.Delete}, "version 0 is below 1"},
		"a negative version":   {shared, sync.Change{ID: id, Op: sync.Delete, Version: -1}, "version -1 is below 1"},
		"an upsert of nothing": {shared, sync.Change{ID: id, Op: sync.Upsert, Version: 1}, "an upsert carries its row"},
		"a delete with a row":  {shared, sync.Change{ID: id, Op: sync.Delete, Version: 2, Row: "row"}, "an upsert carries its row"},
		"a row of nothing":     {shared, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: (*struct{})(nil)}, "serialises to null"},
		"a row of no JSON":     {shared, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: make(chan int)}, "does not serialise"},
		"a private shared row": {shared, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: "row", Visibility: sync.Private, Owner: member},
			"whose rows are never private"},
		"a private row of no one": {owned, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: "row", Visibility: sync.Private},
			"a private row without its owner"},
		"an owner on a shared row": {owned, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: "row", Owner: member},
			"an owner on a shared row"},
		"a redacted row": {owned, sync.Change{ID: id, Op: sync.Upsert, Version: 1, Row: "row", Visibility: "redacted", Owner: member},
			`visibility "redacted"`},
	} {
		t.Run(name, func(t *testing.T) {
			tc.change.Entity = tc.entity.Name
			err := tc.change.Check(tc.entity)
			switch {
			case tc.want == "" && err != nil:
				t.Fatalf("Check: %v", err)
			case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
				t.Fatalf("Check: %v, want an error saying %q", err, tc.want)
			}
		})
	}
}
