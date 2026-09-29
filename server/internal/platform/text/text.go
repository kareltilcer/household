// Package text holds the one check the server makes of the short texts people name things with: an
// account's display name, a household's name, and the names later modules keep.
package text

import (
	"strings"
	"unicode"
)

// Name is name as a name is kept, trimmed, and false when nothing is left or it holds a control
// character, a line break, U+2028 and U+2029 among them, or a bidirectional control, U+202E among
// them, which would turn the name, and the text shown after it, around.
func Name(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && strings.IndexFunc(name, func(r rune) bool {
		return unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp, unicode.Bidi_Control)
	}) < 0
}
