package audit_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/audit"
)

func TestCheckRefusesAnEventItCannotRecord(t *testing.T) {
	entity, owner := uuid.MustParse("01900000-0000-7000-8000-0000000000c1"), uuid.MustParse("01900000-0000-7000-8000-0000000000b1")
	valid := func() audit.Event {
		return audit.Event{
			Module: "garden", Action: "planting.create", EntityType: "garden.planting", EntityID: entity,
			SummaryKey: "garden.planting.create", Visibility: audit.Private, Owner: owner,
			Changes: []audit.Change{{Field: "crop", New: "tomato"}},
		}
	}
	if err := valid().Check(); err != nil {
		t.Fatalf("a valid event: %v", err)
	}
	for name, tc := range map[string]struct {
		spoil func(*audit.Event)
		want  string
	}{
		"no module":                 {func(e *audit.Event) { e.Module = "" }, "no module"},
		"an uppercase action":       {func(e *audit.Event) { e.Action = "Planting.Create" }, "is not lowercase words joined by dots"},
		"an empty action":           {func(e *audit.Event) { e.Action = "" }, "is not lowercase words joined by dots"},
		"no summary key":            {func(e *audit.Event) { e.SummaryKey = "" }, "no summary key"},
		"a level of its own":        {func(e *audit.Event) { e.Level = "loud" }, `level "loud"`},
		"an entity type with no id": {func(e *audit.Event) { e.EntityID = uuid.Nil }, "an entity type without its id"},
		"an id with no entity type": {func(e *audit.Event) { e.EntityType = "" }, "an entity type without its id"},
		"another module's entity":   {func(e *audit.Event) { e.EntityType = "notes.page" }, "is not module garden's"},
		"a prefix that is no module": {func(e *audit.Event) { e.EntityType = "gardener.planting" },
			"is not module garden's"},
		"a private event with no owner": {func(e *audit.Event) { e.Owner = uuid.Nil }, "a private event without its owner"},
		"a shared event with an owner":  {func(e *audit.Event) { e.Visibility = audit.Shared }, "an owner on a shared event"},
		"a visibility of its own":       {func(e *audit.Event) { e.Visibility = "secret" }, `visibility "secret"`},
		"the platform's via":            {func(e *audit.Event) { e.Meta = map[string]any{"via": "web"} }, `meta key "via"`},
		"the platform's request id":     {func(e *audit.Event) { e.Meta = map[string]any{"request_id": "x"} }, `meta key "request_id"`},
		"a diff of no field":            {func(e *audit.Event) { e.Changes = append(e.Changes, audit.Change{}) }, `a diff of field ""`},
		"a field diffed twice": {func(e *audit.Event) { e.Changes = append(e.Changes, audit.Change{Field: "crop"}) },
			`a diff of field "crop"`},
	} {
		t.Run(name, func(t *testing.T) {
			e := valid()
			tc.spoil(&e)
			if err := e.Check(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Check: %v, want an error saying %q", err, tc.want)
			}
		})
	}
}
