package vectors_test

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/vectors"
)

func ptr(s string) *string { return &s }

// Problems refuses what @household/test-vectors' problems() refuses, message for message.
func TestProblemsNamesEachFault(t *testing.T) {
	out := json.RawMessage(`1`)
	for name, tc := range map[string]struct {
		cases []vectors.Case
		want  string
	}{
		"no cases":      {nil, "g: no cases"},
		"a name twice":  {[]vectors.Case{{Name: "a", Output: out}, {Name: "a", Output: out}}, `g: two cases named "a"`},
		"neither":       {[]vectors.Case{{Name: "a"}}, `g: "a" has both an output and an error, or neither`},
		"both":          {[]vectors.Case{{Name: "a", Output: out, Error: ptr("x")}}, `g: "a" has both an output and an error, or neither`},
		"an empty code": {[]vectors.Case{{Name: "a", Error: ptr("")}}, `g: "a" has an error that is not a code`},
	} {
		f := vectors.File{Description: "d", Sources: []string{"s"}, Groups: map[string][]vectors.Case{"g": tc.cases}}
		if got := f.Problems(); !slices.Contains(got, tc.want) {
			t.Errorf("%s: got %v, want %q among them", name, got, tc.want)
		}
	}
	empty := vectors.File{}
	if got := empty.Problems(); !slices.Equal(got, []string{"no description", "no sources", "no groups"}) {
		t.Errorf("an empty file: got %v", got)
	}
}

func TestEveryVectorFileLoads(t *testing.T) {
	for _, name := range []string{"money", "i18n"} {
		if _, err := vectors.Load(name); err != nil {
			t.Error(err)
		}
	}
	if _, err := vectors.Load("no-such-file"); err == nil {
		t.Error("a missing file loaded")
	}
}

func TestDecodeRefusesAFieldItDoesNotHave(t *testing.T) {
	type input struct {
		A int `json:"a"`
	}
	if _, err := vectors.Decode[input](json.RawMessage(`{"a": 1, "b": 2}`)); !vectors.Undecodable(err) {
		t.Fatalf("got %v", err)
	}
	if v, err := vectors.Decode[input](json.RawMessage(`{"a": 1}`)); err != nil || v.A != 1 {
		t.Fatalf("got %v, %v", v, err)
	}
}
