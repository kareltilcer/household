// Package breach screens a password against the passwords known from public breaches (FR-ID1,
// D-12): the Have I Been Pwned corpus, held on the server's own disk, so that no password
// material, hashed or prefixed, leaves the platform to be checked.
//
// The corpus is a file of the first 8 bytes of each breached password's SHA-1, big-endian,
// sorted and unique, after a 16-byte header: the magic "HHBRCH1\n" and the record count. A
// password is breached when its own prefix is in the file, which a binary search finds with
// some thirty reads. Eight bytes of a billion hashes collide with a password nobody has breached
// about once in eighteen billion checks, and a collision refuses a password, never admits one.
// cmd/breach-dataset builds the file (docs/runbooks/breached-passwords.md).
package breach

import (
	"bufio"
	"bytes"
	"crypto/sha1" //nolint:gosec // G505: the corpus is keyed by SHA-1, as Have I Been Pwned publishes it; nothing here is a signature.
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

// Magic starts every corpus file; its last digit is the format's version.
var Magic = [8]byte{'H', 'H', 'B', 'R', 'C', 'H', '1', '\n'}

const (
	headerSize = 16
	recordSize = 8
)

// Prefix is the first 8 bytes of password's SHA-1, as the corpus holds it.
func Prefix(password string) uint64 {
	sum := sha1.Sum([]byte(password)) //nolint:gosec // G401: see the import.
	return binary.BigEndian.Uint64(sum[:recordSize])
}

// Corpus is an open corpus file.
type Corpus struct {
	f     *os.File
	count int64
}

// Open opens the corpus at path and checks that it is one: the magic, and a size that is its
// header and its records.
func Open(path string) (*Corpus, error) {
	f, err := os.Open(path) //nolint:gosec // G304: the path is the server's own configuration.
	if err != nil {
		return nil, fmt.Errorf("breach: %w", err)
	}
	c, err := open(f)
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("breach: %s: %w", path, err)
	}
	return c, nil
}

func open(f *os.File) (*Corpus, error) {
	var header [headerSize]byte
	if _, err := f.ReadAt(header[:], 0); err != nil {
		return nil, errors.New("not a breached-password corpus: too short")
	}
	if !bytes.Equal(header[:8], Magic[:]) {
		return nil, errors.New("not a breached-password corpus of this format")
	}
	count := binary.BigEndian.Uint64(header[8:])
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	if size < headerSize || uint64(size-headerSize) != count*recordSize || (size-headerSize)%recordSize != 0 {
		return nil, fmt.Errorf("a corpus of %d records is %d bytes, not %d", count, size, headerSize+count*recordSize)
	}
	return &Corpus{f: f, count: int64(count)}, nil //nolint:gosec // G115: count*8 fits the file's int64 size, checked above.
}

// Len is the number of prefixes the corpus holds.
func (c *Corpus) Len() int64 { return c.count }

// Contains reports whether password is in the corpus. It is safe for concurrent use.
func (c *Corpus) Contains(password string) (bool, error) {
	want := Prefix(password)
	var buf [recordSize]byte
	lo, hi := int64(0), c.count
	for lo < hi {
		mid := lo + (hi-lo)/2
		if _, err := c.f.ReadAt(buf[:], headerSize+mid*recordSize); err != nil {
			return false, fmt.Errorf("breach: read the corpus: %w", err)
		}
		switch got := binary.BigEndian.Uint64(buf[:]); {
		case got == want:
			return true, nil
		case got < want:
			lo = mid + 1
		default:
			hi = mid
		}
	}
	return false, nil
}

// Close closes the file.
func (c *Corpus) Close() error { return c.f.Close() }

// Writer writes a corpus file from prefixes given in ascending order, a repeated one once.
type Writer struct {
	f     *os.File
	w     *bufio.Writer
	count uint64
	last  uint64
}

// Create starts a corpus at path, replacing any file there.
func Create(path string) (*Writer, error) {
	f, err := os.Create(path) //nolint:gosec // G304: the path is the operator's, on the command line.
	if err != nil {
		return nil, fmt.Errorf("breach: %w", err)
	}
	w := &Writer{f: f, w: bufio.NewWriterSize(f, 1<<20)}
	// The count is written when the corpus is closed.
	if _, err := w.w.Write(make([]byte, headerSize)); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("breach: %w", err)
	}
	return w, nil
}

// ErrUnsorted is Add's answer to a prefix below the one before it.
var ErrUnsorted = errors.New("breach: prefixes out of order")

// Add appends prefix, which is not below the last one added. A prefix equal to the last is
// skipped: two hashes that share their first 8 bytes are one record.
func (w *Writer) Add(prefix uint64) error {
	if w.count > 0 {
		switch {
		case prefix < w.last:
			return fmt.Errorf("%w: %016x after %016x", ErrUnsorted, prefix, w.last)
		case prefix == w.last:
			return nil
		}
	}
	var buf [recordSize]byte
	binary.BigEndian.PutUint64(buf[:], prefix)
	if _, err := w.w.Write(buf[:]); err != nil {
		return fmt.Errorf("breach: %w", err)
	}
	w.count++
	w.last = prefix
	return nil
}

// Count is the number of records added.
func (w *Writer) Count() uint64 { return w.count }

// Close writes the header and closes the file. The file is a corpus only once Close succeeds.
func (w *Writer) Close() error {
	err := w.w.Flush()
	if err == nil {
		var header [headerSize]byte
		copy(header[:8], Magic[:])
		binary.BigEndian.PutUint64(header[8:], w.count)
		_, err = w.f.WriteAt(header[:], 0)
	}
	if err == nil {
		err = w.f.Sync()
	}
	if cerr := w.f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return fmt.Errorf("breach: %w", err)
	}
	return nil
}

// Abort closes and removes an unfinished corpus.
func (w *Writer) Abort() {
	_ = w.f.Close()
	_ = os.Remove(w.f.Name())
}

var _ io.Closer = (*Corpus)(nil)
