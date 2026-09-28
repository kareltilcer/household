// Package vectors runs the shared test vectors of packages/test-vectors against the server's
// implementation of a rule (D-37). @household/test-vectors/vitest runs the same files against
// the clients', so the two agree case for case or CI fails. The format is in
// packages/test-vectors/README.md.
package vectors

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/repo"
)

// Dir is where the vector files live, relative to the repository root.
const Dir = "packages/test-vectors/vectors"

// Case is one input, and either the output it gives or the code of the error it raises.
type Case struct {
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input"`
	Output json.RawMessage `json:"output,omitempty"`
	Error  *string         `json:"error,omitempty"`
}

// File is a vector file.
type File struct {
	Description string            `json:"description"`
	Sources     []string          `json:"sources"`
	Groups      map[string][]Case `json:"groups"`
}

// Subject computes one group's output from a case's input, which it decodes itself. An error
// it returns is compared, by its code, with the case's.
type Subject func(input json.RawMessage) (any, error)

// Load reads and checks vectors/<name>.json: its fields are the format's and no others, and
// Problems finds nothing wrong with it.
func Load(name string) (*File, error) {
	raw, err := repo.ReadFile(Dir + "/" + name + ".json")
	if err != nil {
		return nil, err
	}
	var f File
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("vectors: %s.json: %w", name, err)
	}
	if p := f.Problems(); len(p) > 0 {
		return nil, fmt.Errorf("vectors: %s.json:\n  %s", name, strings.Join(p, "\n  "))
	}
	return &f, nil
}

// Problems returns what is wrong with f beyond its shape, as @household/test-vectors'
// problems() does: a group with no cases, two cases of one name in a group, or a case with
// both an output and an error, or neither.
func (f *File) Problems() []string {
	var found []string
	if strings.TrimSpace(f.Description) == "" {
		found = append(found, "no description")
	}
	if len(f.Sources) == 0 {
		found = append(found, "no sources")
	}
	if len(f.Groups) == 0 {
		found = append(found, "no groups")
	}
	for _, group := range slices.Sorted(maps.Keys(f.Groups)) {
		cases := f.Groups[group]
		if len(cases) == 0 {
			found = append(found, group+": no cases")
		}
		names := make(map[string]bool, len(cases))
		for _, c := range cases {
			if strings.TrimSpace(c.Name) == "" {
				found = append(found, group+": a case with no name")
			}
			if names[c.Name] {
				found = append(found, fmt.Sprintf("%s: two cases named %q", group, c.Name))
			}
			names[c.Name] = true
			if (c.Output != nil) == (c.Error != nil) {
				found = append(found, fmt.Sprintf("%s: %q has both an output and an error, or neither", group, c.Name))
			}
			if c.Error != nil && *c.Error == "" {
				found = append(found, fmt.Sprintf("%s: %q has an error that is not a code", group, c.Name))
			}
		}
	}
	return found
}

// Run runs every case of vectors/<name>.json, each as a subtest named group/case. A case with
// an output passes when its subject returns a value whose JSON equals it; a case with an error
// passes when its subject returns an error whose code, read by code, is that code. The file's
// groups and subjects' must be the same set, so every case is run on this side.
func Run(t *testing.T, name string, subjects map[string]Subject, code func(error) string) {
	t.Helper()
	f, err := Load(name)
	if err != nil {
		t.Fatal(err)
	}
	groups := slices.Sorted(maps.Keys(f.Groups))
	if want := slices.Sorted(maps.Keys(subjects)); !slices.Equal(groups, want) {
		t.Fatalf("vectors: %s.json has groups %v; the subjects are for %v", name, groups, want)
	}
	for _, group := range groups {
		subject := subjects[group]
		t.Run(group, func(t *testing.T) {
			for _, c := range f.Groups[group] {
				t.Run(c.Name, func(t *testing.T) {
					check(t, c, subject, code)
				})
			}
		})
	}
}

func check(t *testing.T, c Case, subject Subject, code func(error) string) {
	t.Helper()
	got, err := subject(c.Input)
	if c.Error != nil {
		if err == nil {
			t.Fatalf("want error %s, got %v", *c.Error, got)
		}
		if gotCode := code(err); gotCode != *c.Error {
			t.Fatalf("want error %s, got %q (%v)", *c.Error, gotCode, err)
		}
		return
	}
	if err != nil {
		t.Fatalf("want %s, got error %v", c.Output, err)
	}
	out, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("encode the output: %v", err)
	}
	equal, err := sameJSON(out, c.Output)
	if err != nil {
		t.Fatal(err)
	}
	if !equal {
		t.Fatalf("want %s, got %s", c.Output, out)
	}
}

// sameJSON reports whether a and b are the same JSON value, numbers compared as written: a
// vector's integers stay exact past 2^53, where a float64 would round them.
func sameJSON(a, b []byte) (bool, error) {
	var x, y any
	for _, v := range []struct {
		raw []byte
		to  *any
	}{{a, &x}, {b, &y}} {
		dec := json.NewDecoder(bytes.NewReader(v.raw))
		dec.UseNumber()
		if err := dec.Decode(v.to); err != nil {
			return false, fmt.Errorf("vectors: compare %s: %w", v.raw, err)
		}
	}
	return reflect.DeepEqual(x, y), nil
}

// Decode decodes a case's input into T, refusing fields T does not have, so a vector file and
// its Go subject cannot disagree about a field's name unnoticed.
func Decode[T any](input json.RawMessage) (T, error) {
	var v T
	dec := json.NewDecoder(bytes.NewReader(input))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return v, errors.Join(errDecode, err)
	}
	return v, nil
}

// errDecode marks an input the subject could not decode, which is a fault in the vector file
// or its subject rather than a refusal the rule makes.
var errDecode = errors.New("vectors: the input does not decode")

// Undecodable reports whether err is Decode's.
func Undecodable(err error) bool { return errors.Is(err, errDecode) }
