package household

import "testing"

// The name an owner types to delete a household (FR-PR6) is the household's whatever its case, the
// space around it and how many spaces stand between its words: a page draws a run of spaces as one,
// so a name kept with two in a row is typed with one by whoever reads it there, and compared
// exactly it could never be typed at all.
func TestTheTypedNameIsTheHouseholdsHoweverItsSpacesAreWritten(t *testing.T) {
	for _, tc := range []struct {
		typed, name string
		want        bool
	}{
		{"Tilcerovi", "Tilcerovi", true},
		{" tilcerovi ", "Tilcerovi", true},
		{"TILCEROVI", "Tilcerovi", true},
		// Kept with two spaces, and read on a page with one.
		{"Novákovi doma", "Novákovi  doma", true},
		{"Novákovi  doma", "Novákovi doma", true},
		{"novákovi\tdoma", "Novákovi doma", true},
		// Another name, an empty one and a part of the name are not it.
		{"Chata", "Tilcerovi", false},
		{"", "Tilcerovi", false},
		{"   ", "Tilcerovi", false},
		{"Novákovi", "Novákovi doma", false},
		{"Novákovidoma", "Novákovi doma", false},
	} {
		if got := sameName(tc.typed, tc.name); got != tc.want {
			t.Errorf("sameName(%q, %q) = %t, want %t", tc.typed, tc.name, got, tc.want)
		}
	}
}
