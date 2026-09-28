// Command gen writes iso4217_gen.go from packages/domain/src/iso4217.json. `go generate` runs
// it in the money package's directory; `pnpm run gen` runs `go generate` for the whole server.
package main

import (
	"fmt"
	"os"

	"github.com/kareltilcer/household/server/internal/platform/money/internal/codegen"
	"github.com/kareltilcer/household/server/internal/platform/repo"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
}

func run() error {
	table, err := repo.ReadFile(codegen.Source)
	if err != nil {
		return err
	}
	src, err := codegen.Render(table)
	if err != nil {
		return err
	}
	return os.WriteFile(codegen.FileName, src, 0o600)
}
