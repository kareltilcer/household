// Command gen writes codes_gen.go from the contract's ProblemCode enum. `go generate`
// runs it in the problem package's directory; `pnpm run gen` runs `go generate` for the
// whole server.
package main

import (
	"fmt"
	"os"

	apispec "github.com/kareltilcer/household/docs/api"
	"github.com/kareltilcer/household/server/internal/platform/problem/internal/codegen"
)

func main() {
	src, err := codegen.Render(apispec.OpenAPI)
	if err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(codegen.FileName, src, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
}
