// Command breach-dataset builds the breached-password corpus the server screens new passwords
// against (FR-ID1, D-12; internal/platform/breach): the Have I Been Pwned Pwned Passwords corpus,
// by Troy Hunt, CC BY 4.0. docs/runbooks/breached-passwords.md says when and how to run it.
//
//	breach-dataset -out FILE [-from FILE] [-min-count N] [-api URL] [-workers N]
//
// Without -from it downloads every one of the 1 048 576 ranges of the k-anonymity API, in order
// of their five-hex-digit prefix, several at once; with -from it reads a corpus already on disk,
// one SHA1:COUNT line per hash in ascending order, as the official downloader writes a single
// file. Either way, the passwords themselves never enter the process: it sees hashes only, and
// writes their first 8 bytes. -min-count keeps only hashes seen at least that many times.
package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/breach"
)

// ranges is the number of five-hex-digit prefixes the API partitions the corpus by.
const ranges = 1 << 20

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Stderr)
	stop()
	os.Exit(code)
}

type options struct {
	out, from, api string
	minCount       uint64
	workers        int
	// ranges is how many ranges a download fetches, from 00000 up: all of them but in tests.
	ranges int
}

func run(ctx context.Context, args []string, stderr io.Writer) int {
	o := options{ranges: ranges}
	fs := flag.NewFlagSet("breach-dataset", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&o.out, "out", "", "the corpus file to write (required)")
	fs.StringVar(&o.from, "from", "", "read SHA1:COUNT lines in ascending order from this file instead of downloading")
	fs.StringVar(&o.api, "api", "https://api.pwnedpasswords.com/range/", "the k-anonymity range API, to which each prefix is appended")
	fs.Uint64Var(&o.minCount, "min-count", 1, "keep only hashes seen at least this many times")
	fs.IntVar(&o.workers, "workers", 32, "ranges downloaded at once")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if o.out == "" || fs.NArg() > 0 || o.workers < 1 || o.minCount < 1 {
		fs.Usage()
		return 2
	}
	started := time.Now()
	count, err := build(ctx, o, stderr)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "breach-dataset:", err)
		return 1
	}
	_, _ = fmt.Fprintf(stderr, "breach-dataset: wrote %d prefixes to %s in %s\n", count, o.out, time.Since(started).Round(time.Second))
	return 0
}

// build writes the corpus and returns how many prefixes it holds. A build that fails leaves no
// file behind, so a half-written corpus is never taken for a whole one.
func build(ctx context.Context, o options, progress io.Writer) (uint64, error) {
	w, err := breach.Create(o.out)
	if err != nil {
		return 0, err
	}
	if o.from != "" {
		err = fromFile(o, w)
	} else {
		err = download(ctx, o, w, progress)
	}
	if err != nil {
		w.Abort()
		return 0, err
	}
	if err := w.Close(); err != nil {
		return 0, err
	}
	return w.Count(), nil
}

// fromFile adds the hashes of o.from, one SHA1:COUNT line each, in ascending order.
func fromFile(o options, w *breach.Writer) error {
	f, err := os.Open(o.from)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	s := bufio.NewScanner(f)
	for n := 1; s.Scan(); n++ {
		prefix, count, err := parseLine("", s.Text())
		if err != nil {
			return fmt.Errorf("%s:%d: %w", o.from, n, err)
		}
		if count < o.minCount {
			continue
		}
		if err := w.Add(prefix); err != nil {
			return fmt.Errorf("%s:%d: %w", o.from, n, err)
		}
	}
	return s.Err()
}

// parseLine reads one line of the corpus, SUFFIX:COUNT, where suffix completes rangePrefix into a
// 40-digit SHA-1, and returns the hash's first 8 bytes and its count.
func parseLine(rangePrefix, line string) (uint64, uint64, error) {
	hash, countText, ok := strings.Cut(strings.TrimSpace(line), ":")
	hash = rangePrefix + hash
	if !ok || len(hash) != 40 {
		return 0, 0, fmt.Errorf("not a SHA1:COUNT line: %q", line)
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return 0, 0, fmt.Errorf("not a SHA-1: %q", hash)
	}
	count, err := strconv.ParseUint(countText, 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("not a count: %q", countText)
	}
	prefix, err := strconv.ParseUint(hash[:16], 16, 64)
	if err != nil {
		return 0, 0, err
	}
	return prefix, count, nil
}

// fetched is one range, downloaded: its sorted prefixes, or why it could not be.
type fetched struct {
	prefixes []uint64
	err      error
}

// download fetches every range, o.workers at once, and adds them in order of their prefix. Ranges
// finish out of order; a finished range waits for those before it, and no more than o.workers × 4
// are ever held at once.
func download(ctx context.Context, o options, w *breach.Writer, progress io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	client := &http.Client{Timeout: time.Minute}
	window := o.workers * 4
	// Range i's result goes to slot i % window: range i + window is handed out only once range i
	// has been added (credits), so a slot is always empty when its next range finishes.
	results := make([]chan fetched, window)
	total := o.ranges
	for i := range results {
		results[i] = make(chan fetched, 1)
	}
	next := make(chan int)
	var wg sync.WaitGroup
	for range o.workers {
		wg.Go(func() {
			for i := range next {
				p, err := fetchRange(ctx, client, o, i)
				results[i%window] <- fetched{p, err}
			}
		})
	}
	// credits bounds how far the downloads run ahead of the writer.
	credits := make(chan struct{}, window)
	go func() {
		defer close(next)
		for i := range total {
			select {
			case credits <- struct{}{}:
			case <-ctx.Done():
				return
			}
			select {
			case next <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	// Stopping, early or not, stops the hand-out, which ends the workers' loops, and waits for them.
	defer func() {
		cancel()
		wg.Wait()
	}()
	for i := range total {
		var r fetched
		select {
		case r = <-results[i%window]:
		case <-ctx.Done():
			return ctx.Err()
		}
		<-credits
		if r.err != nil {
			return fmt.Errorf("range %05X: %w", i, r.err)
		}
		for _, p := range r.prefixes {
			if err := w.Add(p); err != nil {
				return fmt.Errorf("range %05X: %w", i, err)
			}
		}
		if (i+1)%max(total/64, 1) == 0 {
			_, _ = fmt.Fprintf(progress, "breach-dataset: %d of %d ranges, %d prefixes\n", i+1, total, w.Count())
		}
	}
	return nil
}

// fetchRange downloads range i and returns its prefixes, sorted, keeping those seen at least
// o.minCount times. A refusal the API may lift, 429 or a 5xx, and a failure to connect are tried
// again, waiting longer each time.
func fetchRange(ctx context.Context, client *http.Client, o options, i int) ([]uint64, error) {
	rangePrefix := fmt.Sprintf("%05X", i)
	var last error
	for attempt := range 8 {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(1<<(attempt-1)) * 250 * time.Millisecond):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		prefixes, err := fetchOnce(ctx, client, o.api+rangePrefix, rangePrefix, o.minCount)
		var retry retryable
		switch {
		case ctx.Err() != nil:
			return nil, ctx.Err()
		case errors.As(err, &retry):
			last = err
			continue
		}
		return prefixes, err
	}
	return nil, fmt.Errorf("gave up: %w", last)
}

// fetchOnce asks for the range at url once. A failure to connect is retryable.
func fetchOnce(ctx context.Context, client *http.Client, url, rangePrefix string, minCount uint64) ([]uint64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "household-breach-dataset")
	resp, err := client.Do(req)
	if err != nil {
		return nil, retryable{cause: err}
	}
	defer func() { _ = resp.Body.Close() }()
	return readRange(resp, rangePrefix, minCount)
}

// retryable is a response the API may answer differently if asked again: a status, or a failure
// to connect or to read.
type retryable struct {
	status int
	cause  error
}

func (r retryable) Error() string {
	if r.cause != nil {
		return r.cause.Error()
	}
	return "status " + strconv.Itoa(r.status)
}

// readRange reads a range's response; its caller closes the body.
func readRange(resp *http.Response, rangePrefix string, minCount uint64) ([]uint64, error) {
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, retryable{status: resp.StatusCode}
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var prefixes []uint64
	s := bufio.NewScanner(resp.Body)
	for s.Scan() {
		if strings.TrimSpace(s.Text()) == "" {
			continue
		}
		prefix, count, err := parseLine(rangePrefix, s.Text())
		if err != nil {
			return nil, err
		}
		if count >= minCount {
			prefixes = append(prefixes, prefix)
		}
	}
	if err := s.Err(); err != nil {
		// The body stopped arriving: the range may well arrive whole the next time.
		return nil, retryable{cause: err}
	}
	slices.Sort(prefixes)
	return prefixes, nil
}
