// Command sync-config writes PowerSync's sync configurations, generated from the entity registry
// (internal/syncconfig, ADR 0014), into the repository whose server directory it runs two levels
// below. go generate runs it:
//
//	cd server && go generate ./cmd/sync-config
//
//go:generate go run .
package main

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"

	"github.com/kareltilcer/household/server/internal/syncconfig"
)

func main() {
	if err := run(filepath.Join("..", "..", "..")); err != nil {
		fmt.Fprintln(os.Stderr, "sync-config:", err)
		os.Exit(1)
	}
}

// run writes every generated file under root, the repository's root.
func run(root string) error {
	files, err := syncconfig.Files()
	if err != nil {
		return err
	}
	for _, path := range slices.Sorted(maps.Keys(files)) {
		target := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(target, files[path], 0o644); err != nil { //nolint:gosec // G306: a committed configuration, no secret.
			return err
		}
	}
	return nil
}
