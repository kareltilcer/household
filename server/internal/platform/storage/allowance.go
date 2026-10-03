// Package storage is the platform's account of what households keep (PRD 03 §3, PRD 04 §4–5; plan
// item 14): the storage catalog of what each module owns (FR-ST1), the daily usage sample that
// billing and fair use read (FR-ST2), and the storage picture a household is shown (FR-ST4, FR-HA14).
// The bytes themselves, and the metadata that attributes them, are the files pipeline's
// (internal/platform/files).
package storage

// GB is a gigabyte as storage is sold: a thousand million bytes.
const GB int64 = 1_000_000_000

// Allowance is how much a household may store (PRD 04 §4, D-33, D-34): Base included, then whole
// blocks of Block bytes added as the daily average needs them, up to MaxBlocks, past which uploads
// stop. Reads, downloads and exports never do (FR-FL4, D-28).
type Allowance struct {
	Base, Block int64
	MaxBlocks   int
}

// Default is PRD 04 §4's: 5 GB, then 10 GB blocks, up to 20 of them, 205 GB in all.
var Default = Allowance{Base: 5 * GB, Block: 10 * GB, MaxBlocks: 20}

// Ceiling is the most a household may store: an upload that would take it past is refused 402
// (FR-FL4). Below it an upload always succeeds, and blocks accrue (FR-BI3).
func (a Allowance) Ceiling() int64 { return a.Base + int64(a.MaxBlocks)*a.Block }

// Blocks is how many whole blocks a daily average of average bytes needs (PRD 04 §4, FR-BI3):
// ceil(max(0, average − Base) / Block), never more than MaxBlocks, which the ceiling on what a
// household stores holds the average to anyway. It is the figure the storage screen shows and the
// invoice bills, from one formula (FR-BI4), which packages/test-vectors' storage.json holds the
// clients' twin to (D-37).
func (a Allowance) Blocks(average int64) int {
	over := average - a.Base
	if over <= 0 || a.Block <= 0 {
		return 0
	}
	blocks := (over + a.Block - 1) / a.Block
	if blocks > int64(a.MaxBlocks) {
		return a.MaxBlocks
	}
	return int(blocks)
}

// Included is what blocks blocks bring the allowance to: Base and the blocks in effect.
func (a Allowance) Included(blocks int) int64 { return a.Base + int64(blocks)*a.Block }

// Average is the mean of samples, a period's daily stored bytes, rounded down, and 0 of none (D-31):
// the daily average a period's blocks are computed from, never its peak.
func Average(samples []int64) int64 {
	if len(samples) == 0 {
		return 0
	}
	var sum int64
	for _, s := range samples {
		sum += s
	}
	return sum / int64(len(samples))
}

// Projected is the average a period will end on if the household goes on storing current bytes for
// each of the remaining days it has not been sampled on yet (FR-BI4): the mean of samples and
// remaining days at current, rounded down, and current when there is neither.
func Projected(samples []int64, current int64, remaining int) int64 {
	if remaining < 0 {
		remaining = 0
	}
	days := int64(len(samples) + remaining)
	if days == 0 {
		return current
	}
	sum := current * int64(remaining)
	for _, s := range samples {
		sum += s
	}
	return sum / days
}
