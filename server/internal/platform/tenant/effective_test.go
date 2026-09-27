package tenant

import (
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/access"
)

func TestEffectiveLevel(t *testing.T) {
	for _, tc := range []struct {
		role    access.Role
		module  string
		enabled bool
		granted access.Level
		want    access.Level
	}{
		// The minimum of enablement and grant.
		{access.Member, "garden", true, access.Contribute, access.Contribute},
		{access.Member, "garden", true, access.None, access.None},
		{access.Member, "garden", false, access.Manage, access.None},
		// An owner manages every enabled module, whatever the grant row says, and no disabled one.
		{access.Owner, "garden", true, access.None, access.Manage},
		{access.Owner, "garden", false, access.Manage, access.None},
		// A child never manages, and at most views Finance (FR-AC4).
		{access.Child, "garden", true, access.Manage, access.Contribute},
		{access.Child, "garden", true, access.View, access.View},
		{access.Child, finance, true, access.Contribute, access.View},
		{access.Child, finance, true, access.None, access.None},
		{access.Child, "garden", false, access.Contribute, access.None},
	} {
		if got := effective(tc.role, tc.module, tc.enabled, tc.granted); got != tc.want {
			t.Errorf("%s on %s, enabled %v, granted %v: %v, want %v", tc.role, tc.module, tc.enabled, tc.granted, got, tc.want)
		}
	}
}
