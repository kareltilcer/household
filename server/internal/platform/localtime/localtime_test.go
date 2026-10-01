package localtime_test

import (
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/localtime"
)

func clock(t *testing.T, s string) localtime.Clock {
	t.Helper()
	c, err := localtime.ParseClock(s)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func zone(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestParseClockTakesHHMMAndNothingElse(t *testing.T) {
	for _, ok := range []string{"00:00", "07:30", "23:59"} {
		c, err := localtime.ParseClock(ok)
		if err != nil || c.String() != ok {
			t.Errorf("ParseClock(%q) = %v, %v", ok, c, err)
		}
	}
	for _, bad := range []string{"", "7:30", "24:00", "12:60", "12:5", "12-30", "12:30:00", "ab:cd", "+1:30"} {
		if _, err := localtime.ParseClock(bad); err == nil {
			t.Errorf("ParseClock(%q) took it", bad)
		}
	}
}

// Prague's clocks go from 02:00 to 03:00 on 29 March 2026 and from 03:00 back to 02:00 on 25 October.
func TestAtResolvesEveryWallClockTimeOnce(t *testing.T) {
	prague := zone(t, "Europe/Prague")
	for _, tc := range []struct {
		name  string
		day   time.Time
		clock string
		want  string
	}{
		{"an ordinary winter morning", time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC), "08:00", "2026-01-15T07:00:00Z"},
		{"an ordinary summer morning", time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC), "08:00", "2026-07-15T06:00:00Z"},
		{"the morning the clocks went forward", time.Date(2026, 3, 29, 0, 0, 0, 0, time.UTC), "08:00", "2026-03-29T06:00:00Z"},
		{"a time the clocks skipped", time.Date(2026, 3, 29, 0, 0, 0, 0, time.UTC), "02:30", "2026-03-29T01:30:00Z"},
		{"the gap's first minute", time.Date(2026, 3, 29, 0, 0, 0, 0, time.UTC), "02:00", "2026-03-29T01:00:00Z"},
		{"just before the gap", time.Date(2026, 3, 29, 0, 0, 0, 0, time.UTC), "01:59", "2026-03-29T00:59:00Z"},
		{"a time the clocks repeated, first", time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC), "02:30", "2026-10-25T00:30:00Z"},
		{"the morning the clocks went back", time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC), "08:00", "2026-10-25T07:00:00Z"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := localtime.At(tc.day.Year(), tc.day.Month(), tc.day.Day(), clock(t, tc.clock), prague)
			if got.UTC().Format(time.RFC3339) != tc.want {
				t.Errorf("At(%s, %s) = %s; want %s", tc.day.Format(time.DateOnly), tc.clock, got.UTC().Format(time.RFC3339), tc.want)
			}
		})
	}
}

func TestNextIsTheFirstReadingAfterNow(t *testing.T) {
	prague := zone(t, "Europe/Prague")
	for _, tc := range []struct {
		now, clock, want string
	}{
		// 06:00 Prague: today's seven o'clock is still ahead.
		{"2026-01-15T05:00:00Z", "07:00", "2026-01-15T06:00:00Z"},
		// 07:00 exactly: it is not after now, so tomorrow's.
		{"2026-01-15T06:00:00Z", "07:00", "2026-01-16T06:00:00Z"},
		// 23:00 Prague the night before the clocks go forward: 07:00 is an hour less away.
		{"2026-03-28T22:00:00Z", "07:00", "2026-03-29T05:00:00Z"},
		// 23:00 Prague the night before they go back: an hour more.
		{"2026-10-24T21:00:00Z", "07:00", "2026-10-25T06:00:00Z"},
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		if got := localtime.Next(now, clock(t, tc.clock), prague).UTC().Format(time.RFC3339); got != tc.want {
			t.Errorf("Next(%s, %s) = %s; want %s", tc.now, tc.clock, got, tc.want)
		}
	}
}

func TestAWindowWrapsPastMidnight(t *testing.T) {
	night := localtime.Window{From: clock(t, "22:00"), To: clock(t, "07:00")}
	day := localtime.Window{From: clock(t, "13:00"), To: clock(t, "15:00")}
	for _, tc := range []struct {
		w    localtime.Window
		at   string
		want bool
	}{
		{night, "21:59", false}, {night, "22:00", true}, {night, "23:59", true}, {night, "00:00", true},
		{night, "06:59", true}, {night, "07:00", false}, {night, "12:00", false},
		{day, "12:59", false}, {day, "13:00", true}, {day, "14:59", true}, {day, "15:00", false},
	} {
		if got := tc.w.Contains(clock(t, tc.at)); got != tc.want {
			t.Errorf("%s–%s contains %s: %v; want %v", tc.w.From, tc.w.To, tc.at, got, tc.want)
		}
	}
}

func TestAWindowEndsOnTheWallClock(t *testing.T) {
	prague := zone(t, "Europe/Prague")
	night := localtime.Window{From: clock(t, "22:00"), To: clock(t, "07:00")}
	for _, tc := range []struct {
		now  string
		want string
		in   bool
	}{
		{"2026-01-15T22:30:00Z", "2026-01-16T06:00:00Z", true}, // 23:30, so tomorrow's 07:00
		{"2026-01-16T03:00:00Z", "2026-01-16T06:00:00Z", true}, // 04:00, so today's
		{"2026-01-16T10:00:00Z", "", false},                    // 11:00 is not quiet
		{"2026-03-28T22:00:00Z", "2026-03-29T05:00:00Z", true}, // the night the clocks go forward
		{"2026-10-24T21:00:00Z", "2026-10-25T06:00:00Z", true}, // and the night they go back
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		end, in := night.End(now, prague)
		got := ""
		if in {
			got = end.UTC().Format(time.RFC3339)
		}
		if in != tc.in || got != tc.want {
			t.Errorf("End(%s) = %s, %v; want %s, %v", tc.now, got, in, tc.want, tc.in)
		}
	}
}

// A window that ends in the hour the clocks repeat ends in the pass of it the clock is in: Prague's
// go from 03:00 back to 02:00 on 25 October 2026, and read 02:10 twice, at 00:10 and at 01:10 UTC.
func TestAWindowEndsInTheRepeatedHourItIsIn(t *testing.T) {
	prague := zone(t, "Europe/Prague")
	early := localtime.Window{From: clock(t, "01:00"), To: clock(t, "02:30")}
	for _, tc := range []struct{ now, want string }{
		{"2026-10-25T00:10:00Z", "2026-10-25T00:30:00Z"}, // 02:10 summer time, ending at the first 02:30
		{"2026-10-25T01:10:00Z", "2026-10-25T01:30:00Z"}, // 02:10 winter time, ending at the second
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		end, in := early.End(now, prague)
		if !in || end.UTC().Format(time.RFC3339) != tc.want {
			t.Errorf("End(%s) = %s, %v; want %s", tc.now, end.UTC().Format(time.RFC3339), in, tc.want)
		}
	}
	// A daily time is still its first reading alone, so that a slot comes once that day.
	afterFirst, _ := time.Parse(time.RFC3339, "2026-10-25T00:40:00Z")
	if got := localtime.Next(afterFirst, clock(t, "02:30"), prague).UTC().Format(time.RFC3339); got != "2026-10-26T01:30:00Z" {
		t.Errorf("Next after the first 02:30 = %s; want the next day's", got)
	}
}

func TestZoneFallsBackToTheHouseholdsThenUTC(t *testing.T) {
	if got := localtime.Zone("", "Europe/Prague").String(); got != "Europe/Prague" {
		t.Errorf("no member timezone: %s", got)
	}
	if got := localtime.Zone("America/New_York", "Europe/Prague").String(); got != "America/New_York" {
		t.Errorf("a member's own: %s", got)
	}
	if got := localtime.Zone("Mars/Olympus", "Local").String(); got != "UTC" {
		t.Errorf("neither known: %s", got)
	}
}
