// Package access holds the two words authorization is spoken in (PRD 02 §4, §5): a member's
// role in a household, and their level on a module. Both are the contract's own enums,
// HouseholdRole and AccessLevel, and PostgreSQL's household_role and access_level.
package access

import "fmt"

// Level is a member's access to a module (FR-AC1). Levels are ordered, and each includes
// every level below it, so a check is a comparison: Contribute >= View.
type Level int

const (
	// None means the module is absent for the member, not hidden (FR-AC2): its routes answer
	// 404, its entities never sync, its widgets are not listed.
	None Level = iota
	// View reads.
	View
	// Contribute creates, edits and completes.
	Contribute
	// Manage makes structural changes and hard deletes.
	Manage
)

var levelNames = [...]string{None: "none", View: "view", Contribute: "contribute", Manage: "manage"}

// String returns the level as the contract spells it.
func (l Level) String() string {
	if l < None || l > Manage {
		return fmt.Sprintf("Level(%d)", int(l))
	}
	return levelNames[l]
}

// MarshalText spells the level as the contract does, so that a map of levels is written as the
// contract's grants are.
func (l Level) MarshalText() ([]byte, error) {
	if l < None || l > Manage {
		return nil, fmt.Errorf("access: %v is not an access level", l)
	}
	return []byte(l.String()), nil
}

// UnmarshalText reads a level the contract spells, and refuses any other text.
func (l *Level) UnmarshalText(text []byte) error {
	level, err := ParseLevel(string(text))
	if err != nil {
		return err
	}
	*l = level
	return nil
}

// ParseLevel returns the level the contract spells s.
func ParseLevel(s string) (Level, error) {
	for l, name := range levelNames {
		if name == s {
			return Level(l), nil
		}
	}
	return None, fmt.Errorf("access: %q is not an access level", s)
}

// Role is a member's role in a household (PRD 02 §4). Roles are coarse on purpose: the
// fine-grained control is the module grant.
type Role string

const (
	// Owner is responsible for the household, and has Manage on every module it enables.
	Owner Role = "owner"
	// Member is an adult whose abilities are exactly their module grants.
	Member Role = "member"
	// Child is a managed profile, never granted Manage (FR-AC4).
	Child Role = "child"
)

// Finance is the one module whose ceiling for a child is lower than every other's (FR-AC4).
const Finance = "finance"

// Ceiling is the highest level role may hold on module: Manage for an owner and a member, and for
// a child Contribute, which is View on Finance (FR-AC4). A grant is refused above it where it is
// written and capped at it where it is resolved, so that no stored row lifts a child past it.
func Ceiling(role Role, module string) Level {
	switch {
	case role != Child:
		return Manage
	case module == Finance:
		return View
	}
	return Contribute
}

// ParseRole returns the role the contract spells s.
func ParseRole(s string) (Role, error) {
	switch r := Role(s); r {
	case Owner, Member, Child:
		return r, nil
	}
	return "", fmt.Errorf("access: %q is not a household role", s)
}
