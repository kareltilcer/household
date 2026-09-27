package db

import (
	"embed"
	"io/fs"
)

//go:embed migrations/*.sql
var platformMigrations embed.FS

// PlatformBlock is the number of the platform's migration block. The registry (item 3)
// gives each module another.
const PlatformBlock = 1

// Platform returns the platform's migration block: everything the platform owns, from
// the request role's privileges to the tenancy, sync, audit and billing tables later items
// add.
func Platform() Block {
	sub, err := fs.Sub(platformMigrations, "migrations")
	if err != nil {
		panic("db: the embedded platform migrations: " + err.Error())
	}
	return Block{Name: "platform", Number: PlatformBlock, FS: sub}
}
