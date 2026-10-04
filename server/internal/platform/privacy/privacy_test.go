package privacy

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// An entry's name stays inside the folder the archive is unpacked into, whatever a note is titled,
// and is one every file system takes.
func TestAnEntrysNameIsCleaned(t *testing.T) {
	for name, want := range map[string]string{
		"notes/Nákup na chatu.md":           "notes/Nákup na chatu.md",
		"../../etc/hosts":                   "_/_/etc/hosts",
		"/absolute":                         "_/absolute",
		`C:\Users\jana\smlouva.pdf`:         "C_/Users/jana/smlouva.pdf",
		"what? <when>: \"now\"|*.txt":       "what_ _when__ _now___.txt",
		"trailing dot. ":                    "trailing dot",
		"a//b":                              "a/_/b",
		"tab\tand\nnewline":                 "tab_and_newline",
		"":                                  "_",
		"files/probe/" + long(200) + ".pdf": "files/probe/" + long(116) + ".pdf",
		// Cut where a sentence ends, the name does not end in the dot the cut left.
		long(119) + ". " + long(40): long(119),
		// A name Windows keeps for a device is no file's there, whatever its case or its extension.
		"notes/CON.md":         "notes/_CON.md",
		"notes/nul":            "notes/_nul",
		"aux/Lpt1 .tar.gz":     "_aux/_Lpt1 .tar.gz",
		"notes/console.md":     "notes/console.md",
		"notes/com10.md":       "notes/com10.md",
		"notes/my.con.md":      "notes/my.con.md",
		"files/probe/COM1.pdf": "files/probe/_COM1.pdf",
	} {
		if got := clean(name); got != want {
			t.Errorf("clean(%q) = %q, want %q", name, got, want)
		}
	}
}

func long(n int) string { return string(bytes.Repeat([]byte("x"), n)) }

// A cell of the activity log that begins as a formula does is text to the spreadsheet that opens it,
// whatever a member named themself or titled a thing; any other is written as it is.
func TestACellThatBeginsAsAFormulaIsWrittenAsText(t *testing.T) {
	for value, want := range map[string]string{
		"Jana":                             "Jana",
		"":                                 "",
		"Renamed the list to =2+2":         "Renamed the list to =2+2",
		`=HYPERLINK("https://x.test","Y")`: `'=HYPERLINK("https://x.test","Y")`,
		"+420 777 123 456":                 "'+420 777 123 456",
		"-5 °C":                            "'-5 °C",
		"@jana":                            "'@jana",
		"\t=1+1":                           "'\t=1+1",
		"\r=1+1":                           "'\r=1+1",
	} {
		if got := cell(value); got != want {
			t.Errorf("cell(%q) = %q, want %q", value, got, want)
		}
	}
}

// Two entries a module names alike are both kept, the second under a suffix, whatever their case;
// the platform's own names are never a module's; and the manifest, written last, names every entry
// before it.
func TestAnArchiveKeepsEveryEntryUnderItsOwnName(t *testing.T) {
	var buf bytes.Buffer
	a := newArchive(&buf, time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC))
	a.reserve("notes.json")
	files := []pending{}
	p := &part{a: a, module: "notes", files: &files}
	if err := p.JSON(map[string]string{"title": "Nákup"}); err != nil {
		t.Fatal(err)
	}
	if err := p.JSON(nil); !errors.Is(err, errTwice) {
		t.Fatalf("a second JSON = %v, want errTwice", err)
	}
	for _, name := range []string{"notes/Nákup.md", "notes/nákup.md", "manifest.json", "notes.json", "notes/Nákup.md"} {
		w, err := p.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(w, name); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.finish(Manifest{SchemaVersion: SchemaVersion}); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, f := range zr.File {
		got = append(got, f.Name)
	}
	want := []string{"notes.json", "notes/Nákup.md", "notes/nákup (2).md", "manifest (2).json", "notes (2).json", "notes/Nákup (3).md", "manifest.json"}
	if !slices.Equal(got, want) {
		t.Fatalf("the archive holds %v, want %v", got, want)
	}
	if got, want := a.contents(), []string{"notes.json", "notes/", "manifest (2).json", "notes (2).json", "manifest.json"}; !slices.Equal(got, want) {
		t.Fatalf("its contents are %v, want %v", got, want)
	}
}

// An account's households are resolved together (FR-PR3): what blocks is named at once, what goes
// with the account is scheduled only where someone else is there to be told, and a household that is
// not its user's alone to delete is not theirs to name.
func TestAnAccountsHouseholdsAreResolvedTogether(t *testing.T) {
	alone, shared, member, coOwned, paying := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	standings := []household.Standing{
		{Household: alone, Role: access.Owner, Members: 1, SoleOwner: true, Payer: true},
		{Household: shared, Name: "Tilcerovi", Role: access.Owner, Members: 3, SoleOwner: true, Payer: true},
		{Household: member, Role: access.Member, Members: 4},
		{Household: coOwned, Role: access.Owner, Members: 2, Payer: true},
		{Household: paying, Role: access.Owner, Members: 1, SoleOwner: true, Payer: true, Paying: true},
	}
	lists := func(err error) ([]any, []uuid.UUID) {
		t.Helper()
		var p *problem.Problem
		if !errors.As(err, &p) || p.Code != problem.CodeAccountDeletionBlocked {
			t.Fatalf("resolve = %v, want the blocked problem", err)
		}
		payer, _ := p.Extensions["billing_payer_for"].([]uuid.UUID)
		sole := []any{}
		for _, id := range []uuid.UUID{alone, shared, member, coOwned, paying} {
			if raw, _ := json.Marshal(p.Extensions["sole_owned_households"]); bytes.Contains(raw, []byte(id.String())) {
				sole = append(sole, id)
			}
		}
		return sole, payer
	}
	// Everything at once: the household she alone owns with others in it, and the three she pays
	// for that go on or still charge.
	sole, payer := lists(func() error { _, err := resolve(standings, nil); return err }())
	if !slices.Equal(sole, []any{shared}) || !slices.Equal(payer, []uuid.UUID{shared, coOwned, paying}) {
		t.Fatalf("blocked by %v and %v", sole, payer)
	}
	// Naming the shared one leaves the two billing blocks.
	sole, payer = lists(func() error { _, err := resolve(standings, []uuid.UUID{shared}); return err }())
	if len(sole) != 0 || !slices.Equal(payer, []uuid.UUID{coOwned, paying}) {
		t.Fatalf("with the shared household named, blocked by %v and %v", sole, payer)
	}
	// With billing settled, only the household with others in it is scheduled: nobody is in the
	// other to be told, and it goes with the account.
	standings[3].Payer, standings[4].Paying = false, false
	schedule, err := resolve(standings, []uuid.UUID{shared})
	if err != nil || !slices.Equal(schedule, []uuid.UUID{shared}) {
		t.Fatalf("resolve = %v, %v; want the shared household scheduled", schedule, err)
	}
	// One already scheduled to follow the account is not scheduled again, and blocks nothing.
	standings[1].WithAccount = true
	if schedule, err := resolve(standings, nil); err != nil || len(schedule) != 0 {
		t.Fatalf("resolve = %v, %v; want nothing left to schedule", schedule, err)
	}
	// A household that is not hers alone is not hers to name.
	for _, id := range []uuid.UUID{member, coOwned, uuid.New()} {
		var p *problem.Problem
		if _, err := resolve(standings, []uuid.UUID{id}); !errors.As(err, &p) || p.Code != problem.CodeValidationFailed {
			t.Errorf("naming %s = %v, want it refused", id, err)
		}
	}
}
