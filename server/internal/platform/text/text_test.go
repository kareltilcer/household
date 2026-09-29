package text_test

import (
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/text"
)

// A name is kept trimmed, and refused when nothing is left of it or it holds a character that would
// break the line it is shown on or turn it around. The characters are built here rather than
// written, since a bidirectional control in source is what gosec refuses.
func TestName(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		ok       bool
	}{
		{"  Tilcerovi ", "Tilcerovi", true},
		{"Klára & Miloš", "Klára & Miloš", true},
		{"   ", "", false},
		{"", "", false},
		{"Tilc\nerovi", "Tilc\nerovi", false},
		{"Tilc\terovi", "Tilc\terovi", false},
		{"Tilc" + string(rune(0x2028)) + "erovi", "Tilc" + string(rune(0x2028)) + "erovi", false},
		{"Tilcerovi" + string(rune(0x202e)), "Tilcerovi" + string(rune(0x202e)), false},
		{"Tilc" + string(rune(0x2066)) + "erovi", "Tilc" + string(rune(0x2066)) + "erovi", false},
	} {
		got, ok := text.Name(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("Name(%q) = %q, %v; want %q, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
