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
