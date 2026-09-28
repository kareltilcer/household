package i18n

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"golang.org/x/text/feature/plural"
	"golang.org/x/text/language"
)

// Args are the values a message is formatted with, by argument name. A value is a string or a
// number: any Go integer or float type, or a json.Number, as an audit event's summary
// arguments read back from the database are.
type Args map[string]any

// number is a numeric argument as the renderer uses it: as a float64, the value a JavaScript
// client formats, and as an exact decimal where the argument was an integer.
type number struct {
	f     float64
	exact string // the integer's decimal digits, with its sign; "" for a float
}

// numeric reads v as a number, or reports that it is not one.
func numeric(v any) (number, bool) {
	switch n := v.(type) {
	case int:
		return fromInt(int64(n)), true
	case int8:
		return fromInt(int64(n)), true
	case int16:
		return fromInt(int64(n)), true
	case int32:
		return fromInt(int64(n)), true
	case int64:
		return fromInt(n), true
	case uint8:
		return fromInt(int64(n)), true
	case uint16:
		return fromInt(int64(n)), true
	case uint32:
		return fromInt(int64(n)), true
	case uint:
		return number{f: float64(n), exact: strconv.FormatUint(uint64(n), 10)}, true
	case uint64:
		return number{f: float64(n), exact: strconv.FormatUint(n, 10)}, true
	case float32:
		return finite(float64(n))
	case float64:
		return finite(n)
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return fromInt(i), true
		}
		f, err := n.Float64()
		if err != nil {
			return number{}, false
		}
		return finite(f)
	}
	return number{}, false
}

func fromInt(i int64) number { return number{f: float64(i), exact: strconv.FormatInt(i, 10)} }

func finite(f float64) (number, bool) {
	return number{f: f}, !math.IsNaN(f) && !math.IsInf(f, 0)
}

// minus returns n − offset.
func (n number) minus(offset int64) number {
	if offset == 0 {
		return n
	}
	if n.exact != "" {
		i, err := strconv.ParseInt(n.exact, 10, 64)
		if r := i - offset; err == nil && (r < i) == (offset > 0) {
			return fromInt(r)
		}
	}
	return number{f: n.f - float64(offset)}
}

// negative reports whether n is below zero, or is a negative zero.
func (n number) negative() bool {
	if n.exact != "" {
		return strings.HasPrefix(n.exact, "-")
	}
	return math.Signbit(n.f)
}

// decimal returns |n| in decimal, rounded half away from zero to three fractional digits
// with trailing zeros dropped, as ICU does with its default precision: the integer digits and
// the fraction digits, which may be empty.
func (n number) decimal() (integer, fraction string) {
	digits := n.exact
	if digits == "" {
		// The shortest decimal that reads back as the float, which is the digits ICU rounds.
		digits = strconv.FormatFloat(n.f, 'f', -1, 64)
	}
	digits = strings.TrimPrefix(digits, "-")
	integer, fraction, _ = strings.Cut(digits, ".")
	if len(fraction) > 3 {
		up := fraction[3] >= '5'
		fraction = fraction[:3]
		if up {
			integer, fraction = increment(integer, fraction)
		}
	}
	return integer, strings.TrimRight(fraction, "0")
}

// increment adds one unit in the last place of integer.fraction.
func increment(integer, fraction string) (string, string) {
	b := []byte(integer + fraction)
	i := len(b) - 1
	for ; i >= 0 && b[i] == '9'; i-- {
		b[i] = '0'
	}
	if i < 0 {
		b = append([]byte{'1'}, b...)
	} else {
		b[i]++
	}
	split := len(b) - len(fraction)
	return string(b[:split]), string(b[split:])
}

// jsString is String(n) in JavaScript, which a plain {arg} renders a number as: no grouping,
// no rounding, and an exponent outside 1e-7 ≤ |n| < 1e21.
func (n number) jsString() string {
	if n.exact != "" {
		return n.exact
	}
	f := n.f
	if f == 0 {
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	mantissa, exp, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	e, _ := strconv.Atoi(exp)
	k, point := len(digits), e+1
	switch {
	case k <= point && point <= 21:
		return sign + digits + strings.Repeat("0", point-k)
	case 0 < point && point <= 21:
		return sign + digits[:point] + "." + digits[point:]
	case -6 < point && point <= 0:
		return sign + "0." + strings.Repeat("0", -point) + digits
	}
	expSign := "+"
	if point-1 < 0 {
		expSign = "-"
	}
	body := digits[:1]
	if k > 1 {
		body += "." + digits[1:]
	}
	return sign + body + "e" + expSign + strconv.Itoa(abs(point-1))
}

func abs(i int) int {
	if i < 0 {
		return -i
	}
	return i
}

// symbols are a locale's decimal separators, from CLDR: the grouping separator, the decimal
// separator, and the fewest digits before the first grouping separator for it to be used
// (Polish writes 1000 but 10 000).
type symbols struct {
	group, decimal string
	minGrouping    int
}

// format returns n formatted as ICU's default decimal format does for locale.
func (s symbols) format(n number) string {
	integer, fraction := n.decimal()
	var b strings.Builder
	if n.negative() {
		b.WriteByte('-')
	}
	if len(integer) >= 3+s.minGrouping {
		first := len(integer) % 3
		if first == 0 {
			first = 3
		}
		b.WriteString(integer[:first])
		for i := first; i < len(integer); i += 3 {
			b.WriteString(s.group)
			b.WriteString(integer[i : i+3])
		}
	} else {
		b.WriteString(integer)
	}
	if fraction != "" {
		b.WriteString(s.decimal)
		b.WriteString(fraction)
	}
	return b.String()
}

// category returns the CLDR plural category of n in lang, from its operands after the same
// rounding the number is shown with: 1.00001 is one, 2.0005 is shown 2,001 and is many in
// Czech.
func category(lang language.Tag, ordinal bool, n number) string {
	integer, fraction := n.decimal()
	if len(integer) > 18 {
		// The rules read i's last digits and compare it with small values only.
		integer = "1" + integer[len(integer)-17:]
	}
	i, _ := strconv.Atoi(integer)
	f := 0
	if fraction != "" {
		f, _ = strconv.Atoi(fraction)
	}
	rules := plural.Cardinal
	if ordinal {
		rules = plural.Ordinal
	}
	v := len(fraction)
	if name, ok := forms[rules.MatchPlural(lang, i, v, v, f, f)]; ok {
		return name
	}
	return "other"
}

// forms names each plural form as ICU messages select it.
var forms = map[plural.Form]string{
	plural.Zero:  "zero",
	plural.One:   "one",
	plural.Two:   "two",
	plural.Few:   "few",
	plural.Many:  "many",
	plural.Other: "other",
}

// Format formats m in locale with args. Every argument m uses is checked first, whichever
// branch the arguments choose: a missing one fails with MissingArgument, and one a plural or
// number format needs that is not a finite number with NotANumber.
func (m *Message) Format(locale Locale, args Args) (string, error) {
	info, ok := localeInfo[locale]
	if !ok {
		return "", fail(MalformedMessage, "%q is not a locale Household ships", locale)
	}
	for _, a := range m.arguments {
		v, ok := args[a.Name]
		if !ok || v == nil {
			return "", fail(MissingArgument, "%q needs {%s}", m.source, a.Name)
		}
		if _, isNumber := numeric(v); a.Kind == Number && !isNumber {
			return "", fail(NotANumber, "{%s} is %v, not a number", a.Name, v)
		}
		if _, isString := v.(string); !isString {
			if _, isNumber := numeric(v); !isNumber {
				return "", fail(NotAValue, "{%s} is a %T, not a string or a number", a.Name, v)
			}
		}
	}
	var b strings.Builder
	m.write(&b, m.nodes, info, args, nil)
	return b.String(), nil
}

// write renders nodes into b. pound is the value # shows: the enclosing plural's, less its
// offset, or nil outside a plural.
func (m *Message) write(b *strings.Builder, nodes []node, info locale, args Args, pound *number) {
	for _, n := range nodes {
		switch n.kind {
		case textNode:
			b.WriteString(n.text)
		case poundNode:
			if pound != nil {
				b.WriteString(info.symbols.format(*pound))
			}
		case argumentNode:
			b.WriteString(valueString(args[n.arg]))
		case numberNode:
			v, _ := numeric(args[n.arg])
			b.WriteString(info.symbols.format(v))
		case selectNode:
			chosen, _ := choose(n.options, valueString(args[n.arg]), "other")
			m.write(b, chosen, info, args, pound)
		case pluralNode:
			v, _ := numeric(args[n.arg])
			rest := v.minus(n.offset)
			chosen, exact := choose(n.options, "="+v.jsString(), "")
			if !exact {
				chosen, _ = choose(n.options, category(info.tag, n.ordinal, rest), "other")
			}
			m.write(b, chosen, info, args, &rest)
		}
	}
}

// valueString is a value as a plain argument or a select key reads it.
func valueString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	n, _ := numeric(v)
	return n.jsString()
}

// choose returns the message of the option whose key is key, else of the option whose key is
// fallback, and whether either was found. An empty fallback falls back to nothing.
func choose(options []option, key, fallback string) ([]node, bool) {
	var found []node
	ok := false
	for _, o := range options {
		if o.key == key {
			return o.message, true
		}
		if fallback != "" && o.key == fallback {
			found, ok = o.message, true
		}
	}
	return found, ok
}
