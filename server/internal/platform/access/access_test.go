package access_test

import (
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/access"
)

func TestLevelsAreOrderedAndSpelledAsTheContractSpellsThem(t *testing.T) {
	levels := []access.Level{access.None, access.View, access.Contribute, access.Manage}
	var below access.Level = -1
	for _, l := range levels {
		got, err := access.ParseLevel(l.String())
		if err != nil || got != l {
			t.Errorf("ParseLevel(%q) = %v, %v", l.String(), got, err)
		}
		if below >= l {
			t.Errorf("%v does not rank below %v", below, l)
		}
		below = l
	}
	if s := []string{access.None.String(), access.View.String(), access.Contribute.String(), access.Manage.String()}; s[0] != "none" || s[1] != "view" || s[2] != "contribute" || s[3] != "manage" {
		t.Errorf("levels spell %v", s)
	}
	for _, s := range []string{"", "admin", "Manage"} {
		if _, err := access.ParseLevel(s); err == nil {
			t.Errorf("ParseLevel(%q) took it", s)
		}
	}
	if s := access.Level(7).String(); s != "Level(7)" {
		t.Errorf("an unknown level prints %q", s)
	}
}

func TestRoles(t *testing.T) {
	for _, r := range []access.Role{access.Owner, access.Member, access.Child} {
		if got, err := access.ParseRole(string(r)); err != nil || got != r {
			t.Errorf("ParseRole(%q) = %v, %v", r, got, err)
		}
	}
	if _, err := access.ParseRole("admin"); err == nil {
		t.Error("ParseRole took admin")
	}
}
