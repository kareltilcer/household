package sync_test

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/sync"
)

var declared = []sync.Entity{
	{Name: "shopping.item", Table: "shopping_items", Policy: sync.LWWField, Access: sync.Grant},
	{Name: "admin.household_settings", Table: sync.TenantRoot, Policy: sync.StrictVersion, Access: sync.Members,
		Columns: []string{"id", "name"}},
	{Name: "admin.membership", Table: "memberships", Policy: sync.StrictVersion, Access: sync.Members},
	// Item 17's: private, and bounded by an audience.
	{Name: "notes.note", Table: "notes", Policy: sync.LWWRow, Access: sync.Grant | sync.Owner},
	{Name: "chat.message", Table: "chat_messages", Policy: sync.Additive, Access: sync.Grant | sync.Audience},
}

// The grant is two streams, an owner's and a granted member's; every member is one; the tenant root
// names its household by its own id; an entity's columns are what its stream selects; and the
// private and the audience's entities reach no replica yet.
func TestStreamsHoldEachEntityToItsAccess(t *testing.T) {
	streams, err := sync.Streams(declared)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, s := range streams {
		names = append(names, s.Name+" "+s.Entity+" "+strings.Join(s.Reads, ","))
	}
	want := []string{
		"shopping_item_owner shopping.item shopping_items,memberships,module_enablement,households",
		"shopping_item_granted shopping.item shopping_items,module_grants,module_enablement,households",
		"admin_household_settings admin.household_settings households,memberships",
		"admin_membership admin.membership memberships,households",
	}
	if !slices.Equal(names, want) {
		t.Fatalf("streams\n  %s\nwant\n  %s", strings.Join(names, "\n  "), strings.Join(want, "\n  "))
	}
	for _, s := range streams {
		if strings.Contains(s.Query, "deleted_at") {
			t.Errorf("%s drops tombstones, which a client tells a deletion from a lost access by", s.Name)
		}
	}
	if !strings.HasPrefix(streams[0].Query, "SELECT * FROM shopping_items\nWHERE household_id = subscription.parameter('household_id')\n") ||
		!strings.Contains(streams[0].Query, "m.role = 'owner'") || !strings.Contains(streams[0].Query, "e.module = 'shopping' AND e.enabled") {
		t.Errorf("the owner's arm:\n%s", streams[0].Query)
	}
	if !strings.Contains(streams[1].Query, "g.module = 'shopping' AND g.level <> 'none'") {
		t.Errorf("the granted arm:\n%s", streams[1].Query)
	}
	if !strings.HasPrefix(streams[2].Query, "SELECT id, name FROM households\nWHERE id = subscription.parameter('household_id')\n  AND id IN (") {
		t.Errorf("the tenant root's:\n%s", streams[2].Query)
	}
	if got := sync.Tables(streams); !slices.Equal(got, []string{"shopping_items", "memberships", "module_enablement", "households", "module_grants"}) {
		t.Errorf("tables %v", got)
	}
}

// PowerSync caps one connection's parameter results at 1000 (PSYNC_S2305): a lookup of every
// household that enables a module grows with the database until every connection is refused. So
// every table a stream's subquery reads is looked up by the caller or by the subscribed household,
// the tenant root by its own id.
func TestEveryLookupIsTheCallersOrTheHouseholds(t *testing.T) {
	streams, err := sync.Streams(declared)
	if err != nil {
		t.Fatal(err)
	}
	table := regexp.MustCompile(`(?:FROM|JOIN) (\w+) (\w+)`)
	for _, s := range streams {
		_, lookup, ok := strings.Cut(s.Query, " IN (")
		if !ok {
			t.Fatalf("%s has no lookup", s.Name)
		}
		for _, m := range table.FindAllStringSubmatch(lookup, -1) {
			alias := m[2]
			key := ".household_id"
			if m[1] == sync.TenantRoot {
				key = ".id"
			}
			if !strings.Contains(lookup, alias+".user_id = auth.user_id()") &&
				!strings.Contains(lookup, alias+key+" = subscription.parameter('household_id')") {
				t.Errorf("%s looks %s up by neither the caller nor the household:\n%s", s.Name, m[1], s.Query)
			}
		}
	}
}

// A suspended household replicates nothing (D-115): every stream's lookup joins the subscribed
// household and holds it to not being suspended, so that every bucket of it leaves the replicas.
func TestEveryStreamHoldsASuspendedHouseholdToNothing(t *testing.T) {
	streams, err := sync.Streams(declared)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range streams {
		_, lookup, _ := strings.Cut(s.Query, " IN (")
		if !strings.Contains(lookup, "JOIN households h ON h.id = ") ||
			!strings.Contains(lookup, "AND h.id = subscription.parameter('household_id') AND h.suspended_at IS NULL") {
			t.Errorf("%s replicates a suspended household:\n%s", s.Name, s.Query)
		}
		if !slices.Contains(s.Reads, sync.TenantRoot) {
			t.Errorf("%s reads households without naming it among its reads: %v", s.Name, s.Reads)
		}
	}
}

func TestStreamsRefuseTwoOfOneName(t *testing.T) {
	_, err := sync.Streams([]sync.Entity{
		{Name: "a_b.c", Table: "one", Policy: sync.LWWField, Access: sync.Members},
		{Name: "a.b_c", Table: "two", Policy: sync.LWWField, Access: sync.Members},
	})
	if err == nil || !strings.Contains(err.Error(), "a_b_c") {
		t.Fatalf("two streams named a_b_c: %v", err)
	}
}

// The configuration is PowerSync's edition 3, its header a comment, each query indented under its
// stream; the manifest names each stream with its entity and its table.
func TestTheConfigurationAndTheManifest(t *testing.T) {
	streams, err := sync.Streams(declared[:1])
	if err != nil {
		t.Fatal(err)
	}
	config := string(sync.Config("Generated.\nDo not edit.", streams))
	if !strings.HasPrefix(config, "# Generated.\n# Do not edit.\nconfig:\n  edition: 3\n\nstreams:\n  shopping_item_owner:\n    query: |\n      SELECT * FROM shopping_items\n") ||
		!strings.Contains(config, "\n\n  shopping_item_granted:\n") {
		t.Errorf("the configuration:\n%s", config)
	}
	manifest, err := sync.Manifest(streams)
	if err != nil {
		t.Fatal(err)
	}
	var entries []map[string]string
	if err := json.Unmarshal(manifest, &entries); err != nil || len(entries) != 2 ||
		entries[1]["stream"] != "shopping_item_granted" || entries[1]["entity"] != "shopping.item" || entries[1]["table"] != "shopping_items" {
		t.Errorf("the manifest: %s %v", manifest, err)
	}
}
