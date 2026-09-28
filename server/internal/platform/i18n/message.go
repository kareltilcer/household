package i18n

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Code says why a message could not be parsed or formatted. The codes are @household/i18n's,
// and the vectors hold the two renderers to the same code for the same message.
type Code string

// The failures.
const (
	// MalformedMessage is a message that is not ICU MessageFormat.
	MalformedMessage Code = "malformed_message"
	// UnsupportedSyntax is ICU MessageFormat outside the catalogs' subset.
	UnsupportedSyntax Code = "unsupported_syntax"
	// MissingArgument is an argument the message uses that the caller did not pass.
	MissingArgument Code = "missing_argument"
	// NotANumber is an argument a plural or number format needs as a number, passed as
	// something else.
	NotANumber Code = "not_a_number"
	// NotAValue is an argument that is neither a string nor a number. The clients' types
	// refuse one before it is passed, so the vectors have no case of it.
	NotAValue Code = "not_a_value"
)

// Error is a failure to parse or format a message, with its Code.
type Error struct {
	Code    Code
	Message string
}

func (e *Error) Error() string { return "i18n: " + e.Message }

func fail(code Code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

type kind int

const (
	textNode kind = iota
	argumentNode
	numberNode
	pluralNode
	selectNode
	poundNode
)

// node is one element of a parsed message.
type node struct {
	kind    kind
	text    string // textNode
	arg     string // every node but textNode and poundNode
	ordinal bool   // pluralNode: selectordinal
	offset  int64  // pluralNode
	options []option
}

// option is one branch of a plural or select: its selector and its message.
type option struct {
	key     string
	message []node
}

// ArgumentKind is how a message uses an argument: as a number, where a plural, selectordinal
// or number format needs one, or as a value, where a string or a number will do.
type ArgumentKind int

// The kinds.
const (
	Value ArgumentKind = iota
	Number
)

// Argument is one argument a message uses.
type Argument struct {
	Name string
	Kind ArgumentKind
}

// Message is a message parsed within the catalogs' subset, which is @household/i18n's
// (message.ts): text with apostrophe quoting; {arg}; {arg, number} with no style;
// {arg, plural, …} and {arg, selectordinal, …} with an optional offset, =N and the CLDR
// keywords, and #; {arg, select, …}. Every plural or select has other. Dates, times, number
// styles and skeletons, and rich-text tags are outside it, and < is text. It parses as
// FormatJS's parser does with tags ignored, so the same catalog means the same thing here as
// in the apps.
type Message struct {
	source    string
	nodes     []node
	arguments []Argument
}

// Arguments returns the arguments m uses, in the order they first appear.
func (m *Message) Arguments() []Argument { return m.arguments }

// String returns m's source.
func (m *Message) String() string { return m.source }

var (
	argumentName  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	selectKey     = regexp.MustCompile(`^[A-Za-z0-9_]+$`)
	exactSelector = regexp.MustCompile(`^=(0|[1-9][0-9]*)$`)
	pluralKeyword = map[string]bool{"zero": true, "one": true, "two": true, "few": true, "many": true, "other": true}
)

// Parse parses message. A message that is not ICU MessageFormat fails with MalformedMessage,
// and one outside the subset with UnsupportedSyntax.
func Parse(message string) (*Message, error) {
	p := &parser{src: []rune(message), message: message}
	nodes, err := p.parse(0, "")
	if err != nil {
		return nil, err
	}
	if p.pos < len(p.src) {
		return nil, p.malformed("unexpected %q", p.src[p.pos])
	}
	if p.outside != nil {
		return nil, p.outside
	}
	m := &Message{source: message, nodes: nodes}
	seen := map[string]int{}
	var walk func([]node)
	walk = func(nodes []node) {
		for _, n := range nodes {
			switch n.kind {
			case textNode, poundNode:
				continue
			case argumentNode, selectNode, numberNode, pluralNode:
			}
			k := Value
			if n.kind == numberNode || n.kind == pluralNode {
				k = Number
			}
			if i, ok := seen[n.arg]; !ok {
				seen[n.arg] = len(m.arguments)
				m.arguments = append(m.arguments, Argument{Name: n.arg, Kind: k})
			} else if k == Number {
				m.arguments[i].Kind = Number
			}
			for _, o := range n.options {
				walk(o.message)
			}
		}
	}
	walk(nodes)
	return m, nil
}

type parser struct {
	src     []rune
	pos     int
	message string
	// outside is the first construct outside the subset, reported only once the whole
	// message has parsed: a message that is not ICU at all is malformed first.
	outside *Error
}

func (p *parser) malformed(format string, args ...any) *Error {
	return fail(MalformedMessage, "%q: %s", p.message, fmt.Sprintf(format, args...))
}

func (p *parser) unsupported(format string, args ...any) {
	if p.outside == nil {
		p.outside = fail(UnsupportedSyntax, "%q: %s", p.message, fmt.Sprintf(format, args...))
	}
}

func (p *parser) eof() bool { return p.pos >= len(p.src) }

// at returns the rune i past the position, or -1 past the end.
func (p *parser) at(i int) rune {
	if p.pos+i >= len(p.src) {
		return -1
	}
	return p.src[p.pos+i]
}

// parse parses a message up to the end, or at a nesting level above zero up to the brace
// that closes it, which it leaves for the caller. parent is the type of the argument whose
// option this is: # is a number only directly inside a plural or selectordinal.
func (p *parser) parse(level int, parent string) ([]node, error) {
	var nodes []node
	var text strings.Builder
	flush := func() {
		if text.Len() > 0 {
			nodes = append(nodes, node{kind: textNode, text: text.String()})
			text.Reset()
		}
	}
	inPlural := parent == "plural" || parent == "selectordinal"
	for !p.eof() {
		switch ch := p.at(0); {
		case ch == '{':
			flush()
			n, err := p.argument(level)
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, n)
		case ch == '}' && level > 0:
			flush()
			return nodes, nil
		case ch == '#' && inPlural:
			flush()
			nodes = append(nodes, node{kind: poundNode})
			p.pos++
		case ch == '\'':
			text.WriteString(p.quote(inPlural))
		default:
			text.WriteRune(ch)
			p.pos++
		}
	}
	flush()
	return nodes, nil
}

// quote reads an apostrophe at the position: two are one apostrophe; one before a brace, an
// angle bracket or, in a plural, a # starts quoted text, which runs to the next lone
// apostrophe or the end; any other is itself.
func (p *parser) quote(inPlural bool) string {
	switch next := p.at(1); {
	case next == '\'':
		p.pos += 2
		return "'"
	case next == '{' || next == '}' || next == '<' || next == '>' || next == '#' && inPlural:
	default:
		p.pos++
		return "'"
	}
	p.pos++
	var quoted strings.Builder
	quoted.WriteRune(p.at(0))
	p.pos++
	for !p.eof() {
		ch := p.at(0)
		if ch == '\'' {
			if p.at(1) == '\'' {
				quoted.WriteRune('\'')
				p.pos += 2
				continue
			}
			p.pos++
			break
		}
		quoted.WriteRune(ch)
		p.pos++
	}
	return quoted.String()
}

// isSpace is Unicode's Pattern_White_Space, which ICU skips between an argument's parts.
func isSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x85, 0x200e, 0x200f, 0x2028, 0x2029:
		return true
	}
	return false
}

func (p *parser) skipSpace() {
	for !p.eof() && isSpace(p.at(0)) {
		p.pos++
	}
}

// syntax is Unicode's Pattern_Syntax, which ends a name as white space does.
var syntax = [][2]rune{
	{0x21, 0x2f}, {0x3a, 0x40}, {0x5b, 0x5e}, {0x60, 0x60}, {0x7b, 0x7e}, {0xa1, 0xa7},
	{0xa9, 0xa9}, {0xab, 0xac}, {0xae, 0xae}, {0xb0, 0xb1}, {0xb6, 0xb6}, {0xbb, 0xbb},
	{0xbf, 0xbf}, {0xd7, 0xd7}, {0xf7, 0xf7}, {0x2010, 0x2027}, {0x2030, 0x203e},
	{0x2041, 0x2053}, {0x2055, 0x205e}, {0x2190, 0x245f}, {0x2500, 0x2775},
	{0x2794, 0x2bff}, {0x2e00, 0x2e7f}, {0x3001, 0x3003}, {0x3008, 0x3020},
	{0x3030, 0x3030}, {0xfd3e, 0xfd3f}, {0xfe45, 0xfe46},
}

func isSyntax(r rune) bool {
	for _, span := range syntax {
		if r >= span[0] && r <= span[1] {
			return true
		}
	}
	return false
}

// identifier reads a run of what FormatJS's parser accepts in a name: anything but Unicode's
// White_Space and Pattern_Syntax. White_Space is not the Pattern_White_Space skipped between
// an argument's parts, so a no-break space ends a name without being skipped (the argument is
// malformed), and a left-to-right mark is skipped before a name but belongs to one after it.
func (p *parser) identifier() string {
	start := p.pos
	for !p.eof() && !unicode.Is(unicode.White_Space, p.at(0)) && !isSyntax(p.at(0)) {
		p.pos++
	}
	return string(p.src[start:p.pos])
}

// argument parses an argument from its opening brace to its closing one.
func (p *parser) argument(level int) (node, error) {
	p.pos++ // {
	p.skipSpace()
	if p.eof() {
		return node{}, p.malformed("an argument is not closed")
	}
	if p.at(0) == '}' {
		return node{}, p.malformed("an argument has no name")
	}
	name := p.identifier()
	if name == "" {
		return node{}, p.malformed("an argument's name is malformed")
	}
	if !argumentName.MatchString(name) {
		p.unsupported("%q is not an argument name", name)
	}
	p.skipSpace()
	if p.eof() {
		return node{}, p.malformed("{%s is not closed", name)
	}
	if p.at(0) == '}' {
		p.pos++
		return node{kind: argumentNode, arg: name}, nil
	}
	if p.at(0) != ',' {
		return node{}, p.malformed("{%s is followed by %q", name, p.at(0))
	}
	p.pos++
	p.skipSpace()
	typ := p.identifier()
	p.skipSpace()
	switch typ {
	case "number", "date", "time":
		if typ != "number" {
			p.unsupported("{%s, %s} formats a date", name, typ)
		}
		if p.at(0) == ',' {
			if err := p.style(name); err != nil {
				return node{}, err
			}
			p.unsupported("{%s, %s} has a style", name, typ)
		}
		if p.at(0) != '}' {
			return node{}, p.malformed("{%s, %s is not closed", name, typ)
		}
		p.pos++
		return node{kind: numberNode, arg: name}, nil
	case "plural", "selectordinal", "select":
		return p.options(level, name, typ)
	case "":
		return node{}, p.malformed("{%s, has no type", name)
	default:
		return node{}, p.malformed("{%s, %s}: %s is not a format", name, typ, typ)
	}
}

// style skips a number, date or time style up to the brace that closes its argument, as
// FormatJS's parser reads one: quoted text is passed over, a style that is empty or only
// white space is malformed, and a brace that closes a nested one is read again as the
// argument's own, so `{n, number, {x}}` closes at its first `}`.
func (p *parser) style(name string) error {
	p.pos++ // ,
	p.skipSpace()
	start := p.pos
	depth := 0
	for !p.eof() {
		switch p.at(0) {
		case '\'':
			p.pos++
			for !p.eof() && p.at(0) != '\'' {
				p.pos++
			}
			if p.eof() {
				return p.malformed("{%s has an unclosed quote in its style", name)
			}
		case '{':
			depth++
		case '}':
			if depth == 0 {
				if strings.TrimRightFunc(string(p.src[start:p.pos]), isJSSpace) == "" {
					return p.malformed("{%s has an empty style", name)
				}
				return nil
			}
			depth--
			continue
		}
		p.pos++
	}
	return p.malformed("{%s is not closed", name)
}

// isJSSpace is what JavaScript's trimEnd removes: its white space (the Zs category, tab,
// vertical tab, form feed and the byte-order mark) and its line terminators.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', 0x2028, 0x2029, 0xfeff:
		return true
	}
	return unicode.Is(unicode.Zs, r)
}

// options parses a plural, selectordinal or select from after its type to its closing brace.
func (p *parser) options(level int, name, typ string) (node, error) {
	if p.at(0) != ',' {
		return node{}, p.malformed("{%s, %s has no options", name, typ)
	}
	p.pos++
	p.skipSpace()
	n := node{kind: selectNode, arg: name}
	if typ != "select" {
		n.kind, n.ordinal = pluralNode, typ == "selectordinal"
		// As FormatJS reads it: a first name of `offset` is the offset, whose colon must
		// follow at once, and any other is the first option's key.
		start := p.pos
		if p.identifier() == "offset" {
			if p.at(0) != ':' {
				return node{}, p.malformed("{%s, %s: offset has no value", name, typ)
			}
			p.pos++
			p.skipSpace()
			offset, ok := p.integer()
			if !ok {
				return node{}, p.malformed("{%s, %s has a malformed offset", name, typ)
			}
			n.offset = offset
		} else {
			p.pos = start
		}
	}
	seen := map[string]bool{}
	for {
		p.skipSpace()
		start := p.pos
		key := p.identifier()
		if key == "" && typ != "select" && p.at(0) == '=' {
			p.pos++
			if _, ok := p.integer(); !ok {
				return node{}, p.malformed("{%s, %s has a malformed =N", name, typ)
			}
			key = string(p.src[start:p.pos])
		}
		if key == "" {
			break
		}
		if seen[key] {
			return node{}, p.malformed("{%s, %s names %s twice", name, typ, key)
		}
		seen[key] = true
		switch {
		case typ == "select" && !selectKey.MatchString(key):
			p.unsupported("%q is not a select key", key)
		case typ != "select" && !pluralKeyword[key] && !exactSelector.MatchString(key):
			p.unsupported("%q is not a plural keyword", key)
		}
		p.skipSpace()
		if p.at(0) != '{' {
			return node{}, p.malformed("{%s, %s: %s has no message", name, typ, key)
		}
		p.pos++
		message, err := p.parse(level+1, typ)
		if err != nil {
			return node{}, err
		}
		if p.at(0) != '}' {
			return node{}, p.malformed("{%s, %s: %s's message is not closed", name, typ, key)
		}
		p.pos++
		n.options = append(n.options, option{key: key, message: message})
	}
	if len(n.options) == 0 {
		return node{}, p.malformed("{%s, %s has no options", name, typ)
	}
	if !seen["other"] {
		return node{}, p.malformed("{%s, %s has no other", name, typ)
	}
	if p.at(0) != '}' {
		return node{}, p.malformed("{%s, %s is not closed", name, typ)
	}
	p.pos++
	return n, nil
}

// maxSafeInteger is JavaScript's Number.MAX_SAFE_INTEGER, 2^53 − 1: FormatJS refuses an
// offset or an =N past it.
const maxSafeInteger = 1<<53 - 1

// integer reads an optionally signed decimal integer, within ±maxSafeInteger.
func (p *parser) integer() (int64, bool) {
	start := p.pos
	if r := p.at(0); r == '+' || r == '-' {
		p.pos++
	}
	digits := p.pos
	for !p.eof() && p.at(0) >= '0' && p.at(0) <= '9' {
		p.pos++
	}
	if p.pos == digits {
		p.pos = start
		return 0, false
	}
	v, err := strconv.ParseInt(string(p.src[start:p.pos]), 10, 64)
	return v, err == nil && v >= -maxSafeInteger && v <= maxSafeInteger
}
