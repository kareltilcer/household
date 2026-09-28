package i18n_test

import (
	"encoding/json"
	"errors"
	"testing"
	"testing/fstest"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/vectors"
)

// The shared vectors, rendered by the server: the same message gives the apps' output, and a
// message they refuse is refused with the same code.
func TestVectors(t *testing.T) {
	vectors.Run(t, "i18n", map[string]vectors.Subject{
		"format": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Locale  i18n.Locale `json:"locale"`
				Message string      `json:"message"`
				Args    i18n.Args   `json:"args"`
			}](in)
			if err != nil {
				return nil, err
			}
			m, err := i18n.Parse(v.Message)
			if err != nil {
				return nil, err
			}
			return m.Format(v.Locale, v.Args)
		},
		"match": func(in json.RawMessage) (any, error) {
			preferences, err := vectors.Decode[[]string](in)
			if err != nil {
				return nil, err
			}
			return i18n.Match(preferences...), nil
		},
	}, func(err error) string {
		var e *i18n.Error
		if errors.As(err, &e) {
			return string(e.Code)
		}
		return "not a refusal: " + err.Error()
	})
}

// Every message of every catalog parses here as it does in the apps, and each catalog has
// English's keys: the renderer can say anything the clients can.
func TestTheEmbeddedCatalogsLoad(t *testing.T) {
	c, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	if !c.Has("module.shopping.name") || c.Has("module.nothing.name") {
		t.Fatal("the catalogs do not hold the module names")
	}
	for _, l := range i18n.Locales {
		for _, key := range c.Keys() {
			if _, err := c.Render(l, key, sampleArgs(t, c, key)); err != nil {
				t.Errorf("%s %s: %v", l, key, err)
			}
		}
	}
	want := map[i18n.Locale]string{"en": "Shopping", "cs": "Nákupy", "sk": "Nákupy", "de": "Einkaufen", "pl": "Zakupy"}
	for l, name := range want {
		if got, err := c.Render(l, "module.shopping.name", nil); err != nil || got != name {
			t.Errorf("%s: got %q, %v; want %q", l, got, err, name)
		}
	}
}

// sampleArgs gives every argument key's English message uses a value of its kind, which a
// translation must accept too.
func sampleArgs(t *testing.T, c *i18n.Catalogs, key string) i18n.Args {
	t.Helper()
	m, ok := c.Message(i18n.Source, key)
	if !ok {
		t.Fatalf("no English message for %s", key)
	}
	args := i18n.Args{}
	for _, a := range m.Arguments() {
		if a.Kind == i18n.Number {
			args[a.Name] = 2
		} else {
			args[a.Name] = "x"
		}
	}
	return args
}

func TestRenderFallsBackToEnglish(t *testing.T) {
	c, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	if got, err := c.Render("fr", "module.garden.name", nil); err != nil || got != "Garden" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := c.Render("en", "module.nothing.name", nil); !errors.Is(err, i18n.ErrUnknownKey) {
		t.Fatalf("an unknown key: %v", err)
	}
}

func TestLoadRefusesCatalogsThatDisagree(t *testing.T) {
	catalog := func(body string) *fstest.MapFile { return &fstest.MapFile{Data: []byte(body)} }
	good := `{"a.b": "x"}`
	for name, fsys := range map[string]fstest.MapFS{
		"a catalog missing": {"catalogs/en.json": catalog(good)},
		"a key missing": {
			"catalogs/en.json": catalog(`{"a.b": "x", "a.c": "y"}`), "catalogs/cs.json": catalog(good),
			"catalogs/sk.json": catalog(good), "catalogs/de.json": catalog(good), "catalogs/pl.json": catalog(good),
		},
		"a message outside the subset": {
			"catalogs/en.json": catalog(good), "catalogs/cs.json": catalog(`{"a.b": "{d, date}"}`),
			"catalogs/sk.json": catalog(good), "catalogs/de.json": catalog(good), "catalogs/pl.json": catalog(good),
		},
		"not an object of strings": {
			"catalogs/en.json": catalog(`{"a.b": 1}`), "catalogs/cs.json": catalog(good),
			"catalogs/sk.json": catalog(good), "catalogs/de.json": catalog(good), "catalogs/pl.json": catalog(good),
		},
	} {
		if _, err := i18n.Load(fsys); err == nil {
			t.Errorf("%s: loaded", name)
		}
	}
}

func TestArgumentsAreReadOnceWithTheirKind(t *testing.T) {
	m, err := i18n.Parse("{name} has {n, plural, one {# {thing}} other {# {thing}s}} and {name}")
	if err != nil {
		t.Fatal(err)
	}
	want := []i18n.Argument{{Name: "name", Kind: i18n.Value}, {Name: "n", Kind: i18n.Number}, {Name: "thing", Kind: i18n.Value}}
	got := m.Arguments()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestAnEmptyBranchIsChosenAndRendersNothing(t *testing.T) {
	m, err := i18n.Parse("{n, plural, =0 {} other {#}}")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := m.Format(i18n.English, i18n.Args{"n": 0}); err != nil || got != "" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestArgumentsOfEveryNumericType(t *testing.T) {
	m, err := i18n.Parse("{n, plural, one {# day} other {# days}}")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []any{int8(2), int16(2), int32(2), int64(2), 2, uint(2), uint8(2), uint16(2), uint32(2), uint64(2), float32(2), 2.0, json.Number("2")} {
		if got, err := m.Format(i18n.English, i18n.Args{"n": v}); err != nil || got != "2 days" {
			t.Errorf("%T: got %q, %v", v, got, err)
		}
	}
	if _, err := m.Format(i18n.English, i18n.Args{"n": true}); err == nil {
		t.Error("a bool formatted as a number")
	}
}
