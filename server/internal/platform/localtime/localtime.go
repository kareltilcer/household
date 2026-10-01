// Package localtime turns a time on a household's or a member's clock into an instant, DST included
// (PRD 03 §5): "08:00" means 08:00 where they are, on the day it is asked for, whatever the offset
// that day. Two wall-clock times a year are not one instant: an hour the clocks skip in spring is
// none, and an hour they repeat in autumn is two. Go's time.Date leaves which it picks unspecified,
// so At decides: a skipped time is moved forward by the gap, as the clock on the wall would read it
// an hour later, and a repeated time is its first occurrence.
package localtime

import (
	"fmt"
	"slices"
	"sync"
	"time"
	_ "time/tzdata" // A member's or a household's timezone is read from the zones the binary carries.
)

// Clock is a time of day on a wall clock, minutes since midnight.
type Clock int

// Day is a whole day's minutes.
const Day Clock = 24 * 60

// ParseClock reads "HH:MM", 00:00 to 23:59, and nothing else: no seconds, no single digits.
func ParseClock(s string) (Clock, error) {
	if len(s) != 5 || s[2] != ':' {
		return 0, fmt.Errorf("localtime: %q is not HH:MM", s)
	}
	for i, c := range s {
		if i != 2 && (c < '0' || c > '9') {
			return 0, fmt.Errorf("localtime: %q is not HH:MM", s)
		}
	}
	hh := int(s[0]-'0')*10 + int(s[1]-'0')
	mm := int(s[3]-'0')*10 + int(s[4]-'0')
	if hh > 23 || mm > 59 {
		return 0, fmt.Errorf("localtime: %q is not a time of day", s)
	}
	return Clock(hh*60 + mm), nil
}

// String is c as "HH:MM".
func (c Clock) String() string { return fmt.Sprintf("%02d:%02d", int(c)/60, int(c)%60) }

// Of is the wall-clock time t reads in its own location, to the minute.
func Of(t time.Time) Clock { return Clock(t.Hour()*60 + t.Minute()) }

// At returns the instant the wall clocks of loc read c on the day year-month-day: the first of two
// in an hour the clocks repeat, and, for a time they skip, the instant they would read it had they
// not, which their reading puts after the gap.
func At(year int, month time.Month, day int, c Clock, loc *time.Location) time.Time {
	return readings(year, month, day, c, loc)[0]
}

// readings returns the instants the wall clocks of loc read c on the day year-month-day, earliest
// first: one, or two in an hour the clocks repeat; for a time they skip, the one At gives.
func readings(year int, month time.Month, day int, c Clock, loc *time.Location) []time.Time {
	wall := time.Date(year, month, day, int(c)/60, int(c)%60, 0, 0, time.UTC)
	var found []time.Time
	// The offsets in force a day and a half either side of the time, and at it, are every offset
	// the location has that day, however its transitions fall.
	for _, probe := range []time.Duration{-36 * time.Hour, 0, 36 * time.Hour} {
		_, offset := wall.Add(probe).In(loc).Zone()
		t := wall.Add(-time.Duration(offset) * time.Second)
		local := t.In(loc)
		if local.Year() == year && local.Month() == month && local.Day() == day && Of(local) == c &&
			!slices.ContainsFunc(found, t.Equal) {
			found = append(found, t)
		}
	}
	if len(found) == 0 {
		// Skipped: read on the offset before the gap, the instant lands as far after it as the time
		// was into it.
		_, before := wall.Add(-36 * time.Hour).In(loc).Zone()
		return []time.Time{wall.Add(-time.Duration(before) * time.Second)}
	}
	slices.SortFunc(found, time.Time.Compare)
	return found
}

// Next returns the first instant after now at which the wall clocks of loc read c, as At reads it:
// today's, when it is still ahead, or tomorrow's. A time the clocks repeat is the first of its two
// readings, so that a daily slot comes once on the day they go back.
func Next(now time.Time, c Clock, loc *time.Location) time.Time {
	local := now.In(loc)
	for i := range 3 {
		day := local.AddDate(0, 0, i)
		if t := At(day.Year(), day.Month(), day.Day(), c, loc); t.After(now) {
			return t
		}
	}
	// Unreachable: tomorrow's time is always after now, but three days cover a location that
	// skipped a whole day, as Samoa did in 2011.
	return now.Add(24 * time.Hour)
}

// Window is a stretch of each day on a wall clock, from From up to To, which wraps past midnight
// when To is earlier: 22:00 to 07:00 is the night. From and To are never equal.
type Window struct {
	From, To Clock
}

// Contains reports whether the wall clock reads within w at c.
func (w Window) Contains(c Clock) bool {
	if w.From < w.To {
		return c >= w.From && c < w.To
	}
	return c >= w.From || c < w.To
}

// End returns when w ends, read on loc's clocks, for now within it: the first instant after now at
// which they read its To, today or tomorrow. In an hour the clocks repeat, that is the reading of the
// pass now is in: a window ending at 02:30 on the night the clocks go back from 03:00 to 02:00 ends at
// the second 02:30 for a now at the second 02:10, not a day later. It returns false when now is not
// within w.
func (w Window) End(now time.Time, loc *time.Location) (time.Time, bool) {
	local := now.In(loc)
	if !w.Contains(Of(local)) {
		return time.Time{}, false
	}
	for i := range 3 {
		day := local.AddDate(0, 0, i)
		for _, t := range readings(day.Year(), day.Month(), day.Day(), w.To, loc) {
			if t.After(now) {
				return t, true
			}
		}
	}
	// Unreachable, as for Next.
	return now.Add(24 * time.Hour), true
}

// zones are the locations Zone has loaded, by name: time.LoadLocation reads a zone's rules again on
// every call, and the notification workers ask for the same few for every push quiet hours may hold.
// Only the zones the binary knows are kept, a few hundred at most.
var zones sync.Map

// Zone returns the location the first of names that is an IANA timezone the binary knows names, or
// UTC when none is: the member's own timezone, then their household's. Local, the server's own, is
// no one's.
func Zone(names ...string) *time.Location {
	for _, name := range names {
		if name == "" || name == "Local" {
			continue
		}
		if loc, ok := zones.Load(name); ok {
			return loc.(*time.Location)
		}
		if loc, err := time.LoadLocation(name); err == nil {
			zones.Store(name, loc)
			return loc
		}
	}
	return time.UTC
}
