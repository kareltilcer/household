// Package text holds the checks the server makes of the short texts people write: the names they
// name things with, an account's display name, a household's name and the names later modules keep,
// and the messages they write to one another, an invitation's among them.
package text

import (
	"strings"
	"unicode"
)

// unkept reports whether r is a character no kept text holds: a control character, a line break,
// U+2028 and U+2029 among them, or a bidirectional control, U+202E among them, which would turn the
// text, and the text shown after it, around.
func unkept(r rune) bool {
	return unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp, unicode.Bidi_Control)
}

// Name is name as a name is kept, trimmed, and false when nothing is left or it holds a character no
// kept text holds (unkept), a line break among them.
func Name(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && strings.IndexFunc(name, unkept) < 0
}

// Message is message as a message is kept, trimmed, and false when it holds a character no kept text
// holds (unkept) other than a line break or a tab, which a message of several lines may have. Nothing
// may be left of it: a caller drops a message with nothing in it.
func Message(message string) (string, bool) {
	message = strings.TrimSpace(message)
	return message, strings.IndexFunc(message, func(r rune) bool { return r != '\n' && r != '\t' && unkept(r) }) < 0
}
