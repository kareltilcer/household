// Package entities holds sync-entity declarations for architecture tests 5 and 9 to check:
// some that break a rule, and some that keep it.
package entities

import "github.com/kareltilcer/household/server/internal/platform/sync"

// Declared are declarations for test 5's descriptor rules, by the module that declares them.
func Declared() map[string][]sync.Entity {
	redact := func(row any) (any, error) { return row, nil }
	return map[string][]sync.Entity{
		"garden": {
			// Keeps it: every axis, a state_set with its key and resolution.
			{Name: "garden.task_completion", Table: "garden_task_completions", Policy: sync.StateSet,
				StateSet: &sync.StateSetRule{Key: []string{"task_id", "user_id"}, Resolution: sync.LatestClientTime},
				Access:   sync.Grant | sync.Owner | sync.Audience, Redact: redact, Creates: []string{"postGardenTasksCompletions"}},
			// Keeps it: an additive series with its invariant.
			{Name: "garden.harvest", Table: "garden_harvests", Policy: sync.Additive, Access: sync.Grant,
				Invariant: &sync.Invariant{Rule: sync.NonDecreasing, Series: []string{"planting_id"}, Order: "harvested_on", Field: "total_grams"}},
			{Name: "garden.planting", Table: "garden_plantings", Access: sync.Grant},
			{Name: "garden.bed", Table: "garden_beds", Policy: "last_write_wins", Access: sync.Grant},
			{Name: "garden.dose", Table: "garden_doses", Policy: sync.StateSet, Access: sync.Grant},
			{Name: "garden.marker", Table: "garden_markers", Policy: sync.StateSet, Access: sync.Grant,
				StateSet: &sync.StateSetRule{Key: []string{"bed_id", ""}, Resolution: "newest"}},
			{Name: "garden.note", Table: "garden_notes", Policy: sync.LWWField, Access: sync.Grant,
				StateSet: &sync.StateSetRule{Key: []string{"note_id"}, Resolution: sync.Monotonic}},
			{Name: "garden.plan", Table: "garden_plans", Policy: sync.LWWField, Access: sync.Grant,
				Invariant: &sync.Invariant{Rule: "increasing"}},
			{Name: "garden.photo", Table: "garden_photos", Policy: sync.LWWRow},
			{Name: "garden.season", Table: "garden_seasons", Policy: sync.StrictVersion, Access: sync.Owner},
			{Name: "garden.weather", Table: "garden_weather", Policy: sync.LWWField, Access: sync.Grant | 1<<6},
			{Name: "garden.rule", Table: "garden_rules", Policy: sync.LWWField, Access: sync.Grant, Redact: redact},
			{Name: "garden.variety", Table: "", Policy: sync.LWWField, Access: sync.Grant, Creates: []string{"postGardenVarieties", "postGardenVarieties", ""}},
			{Name: "garden.planting", Table: "garden_plantings", Policy: sync.LWWField, Access: sync.Grant},
			{Name: "notes.page", Table: "notes_pages", Policy: sync.LWWField, Access: sync.Grant},
			{Name: "Garden.Tool", Table: "garden_tools", Policy: sync.LWWField, Access: sync.Grant},
			{Name: "", Table: "garden_things", Policy: sync.LWWField, Access: sync.Grant},
		},
	}
}

// Tabled are entities whose tables testdata/entities/tables.sql makes, for test 5's table rules.
func Tabled() []sync.Entity {
	return []sync.Entity{
		{Name: "probe.compliant", Table: "arch_testdata.compliant_items"},
		{Name: "probe.bare", Table: "arch_testdata.bare_items"},
		{Name: "probe.drifted", Table: "arch_testdata.drifted_items"},
		{Name: "probe.keyed", Table: "arch_testdata.keyed_items"},
		{Name: "probe.gone", Table: "arch_testdata.gone_items"},
	}
}

// Creating are entities whose create operations testdata/entities/openapi.yaml declares, for
// test 9.
func Creating() []sync.Entity {
	return []sync.Entity{
		{Name: "shopping.list", Creates: []string{"postLists", "postListsBatch", "putListsByListId", "postListsMultipart"}},
		{Name: "shopping.item", Creates: []string{"postItems", "postItemsQuick", "postItemsOneOf"}},
		{Name: "shopping.staple", Creates: []string{"postStaples", "getStaples", "postStaplesAction", "postNowhere", "postStaplesAllOf"}},
	}
}
