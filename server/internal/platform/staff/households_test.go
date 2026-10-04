package staff

import (
	"testing"
	"time"
)

// A trial is extended by days of 24 hours, whatever zone the instant it is extended from is in: the
// database driver hands the trial's end over in the server's own zone, where a calendar day across a
// change of the clocks is 23 or 25 hours.
func TestATrialIsExtendedByDaysOfTwentyFourHours(t *testing.T) {
	prague, err := time.LoadLocation("Europe/Prague")
	if err != nil {
		t.Fatal(err)
	}
	for name, from := range map[string]time.Time{
		"across the clocks going back":    time.Date(2026, 10, 20, 10, 15, 0, 0, prague),
		"across the clocks going forward": time.Date(2027, 3, 20, 10, 15, 0, 0, prague),
		"in UTC":                          time.Date(2026, 10, 20, 8, 15, 0, 0, time.UTC),
	} {
		if got := extended(from, 14).Sub(from); got != 14*24*time.Hour {
			t.Errorf("%s: fourteen days more is %v on, want %v", name, got, 14*24*time.Hour)
		}
	}
}
