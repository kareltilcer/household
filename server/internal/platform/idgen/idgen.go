// Package idgen mints UUIDv7 identifiers (PRD 01 §3). Clients mint the ids of what they
// create, so an offline create has a stable identity at once (D-23); the server mints ids
// for what it creates itself (request ids, audit events, seed rows) the same way, so every
// id in the system sorts by the time it was minted.
package idgen

import "github.com/google/uuid"

// New returns a new UUIDv7. It panics only if the system's entropy source fails, which is
// not a condition a caller can recover from.
func New() uuid.UUID {
	return uuid.Must(uuid.NewV7())
}

// String returns a new UUIDv7 in its canonical text form.
func String() string { return New().String() }
