// Command converter is the converter sidecar (plan item 14, Q14, ADR 0015): LibreOffice headless,
// which turns an office document into a PDF, and poppler's pdftoppm, which draws a PDF's first
// page, behind the small HTTP interface the files pipeline's client speaks
// (internal/platform/convert). It runs in its own container (deploy/converter), beside the API, with
// no route out: a document may name remote resources, which a converter with network access would
// fetch.
//
//	converter          serve
//	converter check    ask a running converter whether it answers, for the container's health check
//
// Configuration comes from the environment:
//
//	HOUSEHOLD_CONVERTER_ADDR       where it listens (0.0.0.0:3100)
//	HOUSEHOLD_CONVERTER_SOFFICE    LibreOffice's command (soffice)
//	HOUSEHOLD_CONVERTER_PDFTOPPM   poppler's command (pdftoppm)
//	HOUSEHOLD_CONVERTER_JOBS       how many conversions run at once (2)
//
// Each conversion has a directory of its own, LibreOffice's profile among it, so that two may run at
// once, and a timeout, past which the process and every process it started are killed. What the
// converter cannot convert, a damaged document or one no filter reads, it answers 422, which the
// pipeline takes for good; a conversion that ran out of time is 504, and one waiting for a slot
// longer than that 503, which it tries again later.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strconv"
	"syscall"
	"time"
)

// The converter's limits: the files pipeline's cap on a file, and how long a document and a page
// may take.
const (
	maxBytes      = 100_000_000
	officeTimeout = 2 * time.Minute
	pageTimeout   = 30 * time.Second
	minSide       = 64
	maxSide       = 4096
)

// officeExtensions are the types it converts to PDF, by the extension the pipeline names them by:
// LibreOffice picks its import filter by it, as much as by the bytes.
var officeExtensions = []string{
	"doc", "docx", "docm", "xls", "xlsx", "xlsm", "ppt", "pptx", "pptm", "odt", "ods", "odp", "odg", "rtf",
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.LookupEnv, os.Stderr)
	stop()
	os.Exit(code)
}

// run runs the command args names and returns the process's exit status.
func run(ctx context.Context, args []string, lookup func(string) (string, bool), stderr io.Writer) int {
	env := func(key, def string) string {
		if v, ok := lookup(key); ok && v != "" {
			return v
		}
		return def
	}
	addr := env("HOUSEHOLD_CONVERTER_ADDR", "0.0.0.0:3100")
	log := slog.New(slog.NewJSONHandler(stderr, nil))
	switch {
	case len(args) == 1 && args[0] == "check":
		return check(ctx, addr)
	case len(args) != 0:
		_, _ = fmt.Fprintln(stderr, "usage: converter [check]")
		return 2
	}
	jobs, err := strconv.Atoi(env("HOUSEHOLD_CONVERTER_JOBS", "2"))
	if err != nil || jobs < 1 {
		_, _ = fmt.Fprintln(stderr, "HOUSEHOLD_CONVERTER_JOBS is not a positive number")
		return 2
	}
	c := &converter{
		soffice:  []string{env("HOUSEHOLD_CONVERTER_SOFFICE", "soffice")},
		pdftoppm: []string{env("HOUSEHOLD_CONVERTER_PDFTOPPM", "pdftoppm")},
		office:   officeTimeout, page: pageTimeout,
		slots: make(chan struct{}, jobs), dir: os.TempDir(), log: log,
	}
	srv := &http.Server{Addr: addr, Handler: c.routes(), ReadHeaderTimeout: 10 * time.Second}
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", addr)
	if err != nil {
		log.LogAttrs(ctx, slog.LevelError, "listen", slog.Any("error", err))
		return 1
	}
	log.LogAttrs(ctx, slog.LevelInfo, "converting", slog.String("addr", ln.Addr().String()))
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), officeTimeout)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		log.LogAttrs(ctx, slog.LevelError, "serve", slog.Any("error", err))
		return 1
	}
	return 0
}

// check asks the converter at addr whether it answers.
func check(ctx context.Context, addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 1
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+port+"/healthz", nil)
	if err != nil {
		return 1
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 1
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

// converter converts.
type converter struct {
	// soffice and pdftoppm are the commands, each with any arguments that come first.
	soffice, pdftoppm []string
	// office and page bound how long a document's and a page's conversion may take.
	office, page time.Duration
	// slots bounds how many conversions run at once.
	slots chan struct{}
	// dir is where each conversion's directory is made.
	dir string
	log *slog.Logger
}

func (c *converter) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /pdf", c.pdf)
	mux.HandleFunc("POST /page", c.firstPage)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	return mux
}

// pdf converts the office document the body carries, whose extension the ext parameter names.
func (c *converter) pdf(w http.ResponseWriter, r *http.Request) {
	ext := r.URL.Query().Get("ext")
	if !slices.Contains(officeExtensions, ext) {
		http.Error(w, "not a type this converter reads", http.StatusUnprocessableEntity)
		return
	}
	c.convert(w, r, "document."+ext, c.office, "application/pdf", func(dir, in string) (string, []string) {
		out := filepath.Join(dir, "out")
		return filepath.Join(out, "document.pdf"), append(slices.Clone(c.soffice),
			"--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
			"-env:UserInstallation=file://"+filepath.ToSlash(filepath.Join(dir, "profile")),
			"--convert-to", "pdf", "--outdir", out, in)
	})
}

// firstPage draws the first page of the PDF the body carries, its longer side the side parameter's
// pixels.
func (c *converter) firstPage(w http.ResponseWriter, r *http.Request) {
	side, err := strconv.Atoi(r.URL.Query().Get("side"))
	if err != nil || side < minSide || side > maxSide {
		http.Error(w, "side is not a number of pixels this converter draws", http.StatusUnprocessableEntity)
		return
	}
	c.convert(w, r, "document.pdf", c.page, "image/png", func(dir, in string) (string, []string) {
		out := filepath.Join(dir, "page")
		return out + ".png", append(slices.Clone(c.pdftoppm),
			"-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to", strconv.Itoa(side), in, out)
	})
}

// convert writes the body to name in a directory of its own, runs the command command returns,
// once a slot is free and for no longer than timeout, and answers with the file it names, of
// contentType.
func (c *converter) convert(w http.ResponseWriter, r *http.Request, name string, timeout time.Duration, contentType string,
	command func(dir, in string) (string, []string),
) {
	dir, err := os.MkdirTemp(c.dir, "convert-")
	if err != nil {
		c.fail(w, r, err)
		return
	}
	defer func() { _ = os.RemoveAll(dir) }()
	in := filepath.Join(dir, name)
	if status, err := receive(in, r.Body); err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	select {
	case c.slots <- struct{}{}:
		defer func() { <-c.slots }()
	case <-ctx.Done():
		http.Error(w, "busy", http.StatusServiceUnavailable)
		return
	}
	out, argv := command(dir, in)
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...) //nolint:gosec // G204: the commands are the converter's own configuration.
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "HOME="+dir)
	cmd.WaitDelay = 5 * time.Second
	killGroup(cmd)
	// What the commands print goes nowhere: a damaged document's diagnostics quote it, poppler's an
	// operator it could not read from the page's text, and no log line carries content (FR-NF5). A
	// failure is logged by the command and how it ended.
	err = cmd.Run()
	switch {
	case ctx.Err() != nil:
		c.log.LogAttrs(r.Context(), slog.LevelWarn, "a conversion ran out of time", slog.String("command", filepath.Base(argv[0])))
		http.Error(w, "the conversion ran out of time", http.StatusGatewayTimeout)
		return
	case err != nil:
		c.log.LogAttrs(r.Context(), slog.LevelWarn, "a conversion failed", slog.String("command", filepath.Base(argv[0])),
			slog.Any("error", err))
	}
	f, err := os.Open(out) //nolint:gosec // G304: a path in the conversion's own directory.
	if err != nil {
		http.Error(w, "the document could not be converted", http.StatusUnprocessableEntity)
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		http.Error(w, "the document could not be converted", http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	if _, err := io.Copy(w, f); err != nil {
		c.log.LogAttrs(r.Context(), slog.LevelWarn, "send a conversion", slog.Any("error", err))
	}
}

// receive writes body to path, refusing one over maxBytes or empty.
func receive(path string, body io.Reader) (int, error) {
	f, err := os.Create(path) //nolint:gosec // G304: a path in the conversion's own directory.
	if err != nil {
		return http.StatusInternalServerError, err
	}
	n, err := io.Copy(f, io.LimitReader(body, maxBytes+1))
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	switch {
	case err != nil:
		return http.StatusBadRequest, err
	case n > maxBytes:
		return http.StatusRequestEntityTooLarge, errors.New("larger than the converter takes")
	case n == 0:
		return http.StatusUnprocessableEntity, errors.New("empty")
	}
	return 0, nil
}

func (c *converter) fail(w http.ResponseWriter, r *http.Request, err error) {
	c.log.LogAttrs(r.Context(), slog.LevelError, "conversion failed", slog.Any("error", err))
	http.Error(w, "the converter failed", http.StatusInternalServerError)
}
