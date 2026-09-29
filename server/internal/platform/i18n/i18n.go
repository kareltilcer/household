// Package i18n renders the translation catalogs server-side: push bodies, emails, audit
// summaries and exported documents, each from a key against the recipient's language rather
// than as a stored sentence (PRD 03 §9, FR-AU3). It reads the very catalogs the clients
// compile against, packages/i18n/catalogs, embedded through that directory's Go module, and
// implements the ICU MessageFormat subset @household/i18n holds them to. The two renderers
// are held to the same output by packages/test-vectors/vectors/i18n.json (D-37).
package i18n

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"slices"
	"strings"
	"sync"

	"golang.org/x/text/language"

	catalogs "github.com/kareltilcer/household/packages/i18n"
)

// Locale is a language Household ships in.
type Locale string

// The languages of Household 1.0 (PRD 03 §9).
const (
	English Locale = "en"
	Czech   Locale = "cs"
	Slovak  Locale = "sk"
	German  Locale = "de"
	Polish  Locale = "pl"
)

// Source is the source language: every key is defined by its English message (D-29).
const Source = English

// Locales lists the shipped languages, the source first, as @household/i18n's locales does.
var Locales = []Locale{English, Czech, Slovak, German, Polish}

// locale is what formatting needs to know about a language.
type locale struct {
	tag     language.Tag
	symbols symbols
}

// nbsp is the no-break space CLDR groups Czech, Slovak and Polish digits with.
const nbsp = "\u00a0"

// localeInfo holds each language's plural rules and CLDR decimal symbols.
var localeInfo = map[Locale]locale{
	English: {language.English, symbols{group: ",", decimal: ".", minGrouping: 1}},
	Czech:   {language.Czech, symbols{group: nbsp, decimal: ",", minGrouping: 1}},
	Slovak:  {language.Slovak, symbols{group: nbsp, decimal: ",", minGrouping: 1}},
	German:  {language.German, symbols{group: ".", decimal: ",", minGrouping: 1}},
	Polish:  {language.Polish, symbols{group: nbsp, decimal: ",", minGrouping: 2}},
}

// Match returns the language to address someone who prefers preferences, most preferred
// first, as BCP 47 tags (a member's setting, an Accept-Language list in order): the first
// whose language Household ships, else English. Only the language counts: de-AT is German.
// @household/i18n's matchLocale chooses the same way, so an email and the app agree.
func Match(preferences ...string) Locale {
	for _, tag := range preferences {
		lang, _, _ := strings.Cut(strings.TrimSpace(tag), "-")
		if l := Locale(strings.ToLower(lang)); slices.Contains(Locales, l) {
			return l
		}
	}
	return Source
}

// maxTag is the longest language tag kept, in characters.
const maxTag = 64

// Canonical is tag, a person's or a household's language as a BCP 47 tag, in its canonical form,
// and false when it is not a BCP 47 tag or does not name its language: und, a private-use tag
// such as x-home, and one whose language is only guessed from its region or script, und-CZ. A
// language Household does not ship is kept as it is: Match addresses it in English.
func Canonical(tag string) (string, bool) {
	if len(tag) > maxTag {
		return "", false
	}
	t, err := language.Parse(tag)
	if err != nil {
		return "", false
	}
	if _, confidence := t.Base(); confidence != language.Exact {
		return "", false
	}
	return t.String(), true
}

// ErrUnknownKey is a key the catalogs do not have.
var ErrUnknownKey = errors.New("i18n: no such key")

// Catalogs are the parsed messages of every shipped language.
type Catalogs struct {
	keys     []string
	messages map[Locale]map[string]*Message
}

// Load reads catalogs/<locale>.json from fsys for every shipped language and parses every
// message. It fails on a missing catalog, a catalog whose keys are not English's, and a
// message outside the subset, naming each.
func Load(fsys fs.FS) (*Catalogs, error) {
	c := &Catalogs{messages: make(map[Locale]map[string]*Message, len(Locales))}
	var errs []error
	for _, l := range Locales {
		raw, err := fs.ReadFile(fsys, "catalogs/"+string(l)+".json")
		if err != nil {
			errs = append(errs, fmt.Errorf("i18n: %w", err))
			continue
		}
		var texts map[string]string
		if err := json.Unmarshal(raw, &texts); err != nil {
			errs = append(errs, fmt.Errorf("i18n: catalogs/%s.json: %w", l, err))
			continue
		}
		parsed := make(map[string]*Message, len(texts))
		for _, key := range slices.Sorted(maps.Keys(texts)) {
			m, err := Parse(texts[key])
			if err != nil {
				errs = append(errs, fmt.Errorf("i18n: catalogs/%s.json: %s: %w", l, key, err))
				continue
			}
			parsed[key] = m
		}
		c.messages[l] = parsed
		if l == Source {
			c.keys = slices.Sorted(maps.Keys(texts))
		} else if keys := slices.Sorted(maps.Keys(texts)); c.keys != nil && !slices.Equal(keys, c.keys) {
			errs = append(errs, fmt.Errorf("i18n: catalogs/%s.json does not have English's keys", l))
		}
	}
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return c, nil
}

// Default returns the embedded catalogs, loaded once. The catalogs are checked in CI, so an
// error here is a build that should not have shipped.
var Default = sync.OnceValues(func() (*Catalogs, error) { return Load(catalogs.FS) })

// Keys returns every key, sorted.
func (c *Catalogs) Keys() []string { return slices.Clone(c.keys) }

// Has reports whether key is in the catalogs.
func (c *Catalogs) Has(key string) bool {
	_, ok := c.messages[Source][key]
	return ok
}

// Message returns the parsed message key in locale.
func (c *Catalogs) Message(locale Locale, key string) (*Message, bool) {
	m, ok := c.messages[locale][key]
	return m, ok
}

// Render returns the message key in locale, formatted with args. A locale Household does not
// ship renders in English.
func (c *Catalogs) Render(locale Locale, key string, args Args) (string, error) {
	messages, ok := c.messages[locale]
	if !ok {
		locale, messages = Source, c.messages[Source]
	}
	m, ok := messages[key]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnknownKey, key)
	}
	return m.Format(locale, args)
}
