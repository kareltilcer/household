// Package app assembles the HTTP API from the platform and, from item 3, the modules the
// registry holds, and serves it.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/kareltilcer/household/server/internal/platform/contract"
	"github.com/kareltilcer/household/server/internal/platform/health"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
)

// Deps are what the router's handlers need.
type Deps struct {
	Logger   *slog.Logger
	Contract *contract.Contract
	Health   *health.Health
	// MaxBodyBytes caps a JSON request body at the edge.
	MaxBodyBytes int64
}

// NewRouter returns the server's whole HTTP surface: the platform middleware, and under
// contract.BasePath the contract's edge validation and every implemented route. It refuses
// to build with a route the contract does not declare, so the server never serves one.
func NewRouter(d Deps) (*chi.Mux, error) {
	root := chi.NewRouter()
	root.Use(httpx.RequestScope, httpx.AccessLog(d.Logger), httpx.Recover(d.Logger))
	root.NotFound(httpx.NotFound)
	root.MethodNotAllowed(httpx.MethodNotAllowed(root))

	api := chi.NewRouter()
	api.Use(d.Contract.Middleware(api, d.MaxBodyBytes))
	api.NotFound(httpx.NotFound)
	api.MethodNotAllowed(httpx.MethodNotAllowed(api))

	api.Get("/healthz", d.Health.Liveness)
	api.Get("/readyz", d.Health.Readiness)

	root.Mount(contract.BasePath, api)

	routes, err := contract.Routes(root)
	if err != nil {
		return nil, err
	}
	var undeclared []string
	for _, v := range d.Contract.Diff(routes, nil) {
		//nolint:exhaustive // The other kinds are architecture test 6's to report.
		switch v.Kind {
		case contract.OutsideBase, contract.Undeclared:
			undeclared = append(undeclared, v.String())
		}
	}
	if len(undeclared) > 0 {
		return nil, fmt.Errorf("app: %s", strings.Join(undeclared, "; "))
	}
	return root, nil
}

// Serve serves srv on ln until ctx ends, then stops accepting connections and waits up to
// timeout for requests in flight to finish. It returns nil after a clean shutdown.
func Serve(ctx context.Context, log *slog.Logger, srv *http.Server, ln net.Listener, timeout time.Duration) error {
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()

	select {
	case err := <-served:
		return fmt.Errorf("app: serve: %w", err)
	case <-ctx.Done():
	}

	log.LogAttrs(ctx, slog.LevelInfo, "shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		// Requests still running past the timeout are cut off.
		_ = srv.Close()
		return fmt.Errorf("app: shut down: %w", err)
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("app: serve: %w", err)
	}
	return nil
}

// NewServer returns the http.Server for handler. Reading a request's headers is bounded,
// against slow-loris clients. Reading a body and writing a response are not bounded here:
// an upload over a slow connection (item 16) and the sync stream (item 14) legitimately
// take minutes, and set their own deadlines through http.ResponseController.
func NewServer(handler http.Handler, log *slog.Logger) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
}
