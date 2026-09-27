// Package grant answers whether the caller may use a module, and how far (PRD 01 §5, PRD 02
// §5): from the effective level the tenant middleware resolved once for the request, never
// re-derived by a handler.
package grant

import (
	"context"
	"net/http"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Require returns nil when the caller's effective level on module is at least level. When the
// module is absent for them, because the household disables it or their grant is none, it
// returns the 404 not_found problem, since a 403 would confirm that the household uses the
// module (D-16). When they can see the module but not do this to it, it returns the 403
// forbidden problem. Seeing is always required, so a level below View asks for View. Outside a
// household-scoped request it returns tenant.ErrNoTenant.
func Require(ctx context.Context, module string, level access.Level) error {
	s := tenant.From(ctx)
	if s == nil {
		return tenant.ErrNoTenant
	}
	have := s.Level(module)
	switch {
	case have < access.View:
		return problem.NotFound()
	case have < level:
		return problem.New(http.StatusForbidden, problem.CodeForbidden)
	}
	return nil
}

// Gate answers 404 to every request for module's routes from a caller who cannot see it. The
// platform puts it in front of each module's routes, so that surface 1 of FR-AC2 holds for a
// route whose handler forgets to ask; a handler still asks Require for more than seeing.
func Gate(module string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := Require(r.Context(), module, access.View); err != nil {
				problem.Write(w, reqctx.RequestID(r.Context()), err)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
