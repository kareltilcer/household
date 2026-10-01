// Package arch holds the architecture tests of PRD 01 §10, which fail the build rather
// than a review. Each runs against the real server and against deliberate violations kept
// in testdata, so a check that stops detecting anything fails too.
//
// Item 2 adds test 6 (routes against openapi.yaml, with contract_pending.txt) and test 8
// (no float or numeric money). Item 3 adds 1 (no module imports another), 2 (every tenant
// table is isolated) and 3 (every module exports and erases), and the tenant isolation test
// of FR-NF4; item 4 adds 4, 5 and 9; item 13 adds 10 (the generated sync configuration, and the
// tables its streams read published for PowerSync); item 14 adds 11 (the meter role reads only
// the columns that name, count, size or schedule rows).
package arch
