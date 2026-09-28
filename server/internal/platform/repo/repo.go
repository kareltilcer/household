// Package repo finds files of the repository the server is built from, for the code that
// reads what the TypeScript packages own: a generator reading packages/domain's ISO 4217
// table, a test reading packages/test-vectors. It is for generators and tests, which run
// inside a checkout; the server binary embeds what it needs and reads no file of the
// repository at run time.
package repo

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// marker is the file only the repository root holds.
const marker = "pnpm-workspace.yaml"

// Root returns the repository root: the nearest directory, from the working directory up,
// that holds pnpm-workspace.yaml. `go test` and `go generate` run in the package's own
// directory, so from anywhere in server/ that is the checkout's root.
func Root() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("repo: %w", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, marker)); err == nil {
			return dir, nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("repo: %w", err)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("repo: no %s above the working directory", marker)
		}
		dir = parent
	}
}

// ReadFile reads the file at path, which is slash-separated and relative to the root. The
// read is confined to the repository: a path that climbs out of it fails.
func ReadFile(path string) ([]byte, error) {
	dir, err := Root()
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("repo: %w", err)
	}
	defer func() { _ = root.Close() }()
	b, err := root.ReadFile(filepath.FromSlash(path))
	if err != nil {
		return nil, fmt.Errorf("repo: %w", err)
	}
	return b, nil
}
