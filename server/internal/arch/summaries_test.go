package arch_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/arch/testdata/summaries"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/module"
)

// auditor is what the summary check reads of a module: its id and the actions it records.
type auditor interface {
	Name() string
	AuditActions() []module.AuditAction
}

// The activity log renders every event from its summary key in the reader's language (FR-AU3,
// PRD 03 §9), through internal/platform/i18n from the catalogs the clients compile against, so
// a summary key the catalogs do not have is an event nobody can read. @household/i18n's test
// holds every language to English's keys, so English is the one checked here.
func TestAuditSummariesAreInTheCatalogs(t *testing.T) {
	var mods []auditor
	for _, m := range registry(t).All() {
		mods = append(mods, m)
	}
	for _, p := range registry(t).Platform() {
		mods = append(mods, platformAuditor{p})
	}
	for _, v := range summaryViolations(t, mods...) {
		t.Error(v)
	}
}

// The same check against a deliberate violation: testdata/summaries declares an action whose
// summary key the catalogs have and one whose key they do not.
func TestAuditSummariesAreInTheCatalogsCatchesAViolation(t *testing.T) {
	got := summaryViolations(t, summaries.Module{})
	want := []string{"shopping: audit action shopping.list.create renders shopping.list.create, which the catalogs do not have"}
	if !slices.Equal(got, want) {
		t.Fatalf("violations:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

// platformAuditor is a module the platform serves itself, as the summary check reads it.
type platformAuditor struct{ p module.PlatformModule }

func (a platformAuditor) Name() string                       { return a.p.Name }
func (a platformAuditor) AuditActions() []module.AuditAction { return a.p.Actions }

func summaryViolations(t *testing.T, mods ...auditor) []string {
	t.Helper()
	c, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	var found []string
	for _, m := range mods {
		for _, a := range m.AuditActions() {
			if !c.Has(a.SummaryKey) {
				found = append(found, fmt.Sprintf("%s: audit action %s renders %s, which the catalogs do not have", m.Name(), a.Key, a.SummaryKey))
			}
		}
	}
	return found
}
