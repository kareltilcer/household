package imaging_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/imaging"
)

// photo is a w by h JPEG whose left half is red and right half blue, with an EXIF segment recording
// orientation o when o is not 0.
func photo(t *testing.T, w, h, o int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.RGBA{R: 255, A: 255}
			if x >= w/2 {
				c = color.RGBA{B: 255, A: 255}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	if o == 0 {
		return buf.Bytes()
	}
	// A little-endian TIFF header with one IFD holding the orientation.
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0}
	entry := make([]byte, 12)
	binary.LittleEndian.PutUint16(entry[0:], 0x0112)
	binary.LittleEndian.PutUint16(entry[2:], 3)
	binary.LittleEndian.PutUint32(entry[4:], 1)
	binary.LittleEndian.PutUint16(entry[8:], uint16(o)) //nolint:gosec // G115: an orientation, 1 to 8.
	tiff = append(append(tiff, entry...), 0, 0, 0, 0)
	app1 := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(app1)+2)) //nolint:gosec // G115: a segment of a few dozen bytes.
	out := append([]byte{0xFF, 0xD8}, seg...)
	out = append(out, app1...)
	return append(out, buf.Bytes()[2:]...)
}

func near(c color.Color, r, b uint32) bool {
	cr, _, cb, _ := c.RGBA()
	return (cr>>8 > 200) == (r > 0) && (cb>>8 > 200) == (b > 0)
}

// A photograph taken with the phone turned a quarter is stored on its side and says so: it comes
// out as it was held, its red half on top.
func TestAPhotographComesOutAsItWasHeld(t *testing.T) {
	m, err := imaging.Decode(t.Context(), bytes.NewReader(photo(t, 40, 20, 6)), "image/jpeg", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Release()
	if m.Orientation != 6 {
		t.Fatalf("orientation %d, want 6", m.Orientation)
	}
	if w, h := m.Size(); w != 20 || h != 40 {
		t.Fatalf("size %dx%d, want 20x40 as held", w, h)
	}
	fit := m.Fit(10)
	if b := fit.Bounds(); b.Dx() != 5 || b.Dy() != 10 {
		t.Fatalf("fit %v, want 5x10", b)
	}
	// Turned a quarter clockwise, the stored left half (red) is on top.
	if top, bottom := fit.At(2, 1), fit.At(2, 8); !near(top, 1, 0) || !near(bottom, 0, 1) {
		t.Fatalf("top %v, bottom %v; want red above blue", top, bottom)
	}
	up := m.Fit(100)
	if b := up.Bounds(); b.Dx() != 20 || b.Dy() != 40 {
		t.Fatalf("an image that fits is only turned upright: %v", b)
	}
}

func TestEveryOrientationKeepsItsSize(t *testing.T) {
	for o := 1; o <= 8; o++ {
		m, err := imaging.Decode(t.Context(), bytes.NewReader(photo(t, 30, 10, o)), "image/jpeg", 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		m.Release()
		want := image.Rect(0, 0, 30, 10)
		if o >= 5 {
			want = image.Rect(0, 0, 10, 30)
		}
		if got := m.Fit(100).Bounds(); got != want {
			t.Errorf("orientation %d: %v, want %v", o, got, want)
		}
	}
}

func TestSquareIsTheCentreAsHeld(t *testing.T) {
	m, err := imaging.Decode(t.Context(), bytes.NewReader(photo(t, 60, 20, 0)), "image/jpeg", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Release()
	sq := m.Square(10)
	if b := sq.Bounds(); b.Dx() != 10 || b.Dy() != 10 {
		t.Fatalf("square %v", b)
	}
	// The centre 20x20 of a 60x20 image straddles the red and blue halves.
	if left, right := sq.At(1, 5), sq.At(8, 5); !near(left, 1, 0) || !near(right, 0, 1) {
		t.Fatalf("left %v, right %v", left, right)
	}
	if b := m.Square(1000).Bounds(); b.Dx() != 20 {
		t.Fatalf("a square is never enlarged: %v", b)
	}
}

// A PNG whose header claims more pixels than allowed is refused before a byte of it is decoded.
func TestAnImageWithTooManyPixelsIsRefused(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, 100, 100))); err != nil {
		t.Fatal(err)
	}
	if _, err := imaging.Decode(t.Context(), bytes.NewReader(buf.Bytes()), "image/png", 100*100-1); !errors.Is(err, imaging.ErrTooLarge) {
		t.Fatalf("decode = %v, want ErrTooLarge", err)
	}
	m, err := imaging.Decode(t.Context(), bytes.NewReader(buf.Bytes()), "image/png", 100*100)
	if err != nil {
		t.Fatalf("decode at the limit = %v", err)
	}
	m.Release()
	if _, err := imaging.Decode(t.Context(), bytes.NewReader(buf.Bytes()), "image/heic", 1<<20); !errors.Is(err, imaging.ErrUnsupported) {
		t.Fatalf("decode of a type it does not read = %v", err)
	}
}

// The images decoded at once hold no more than the budget between them, whichever request or worker
// decodes them: a few kilobytes of PNG that decode to a gigabyte each, sent at once, would otherwise
// take the process's memory. An image waits until another is released, for as long as its caller
// lets it; one larger than the whole budget waits for all of it, and is decoded alone.
func TestTheImagesDecodedAtOnceHoldNoMoreThanTheBudget(t *testing.T) {
	encoded := func(img image.Image) []byte {
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	gray := encoded(image.NewGray(image.Rect(0, 0, 100, 100)))
	// Sixteen bits a channel of RGBA: eight times the bytes a pixel of the gray.
	deep := encoded(image.NewNRGBA64(image.Rect(0, 0, 100, 100)))
	one, err := png.DecodeConfig(bytes.NewReader(gray))
	if err != nil {
		t.Fatal(err)
	}
	restore := imaging.SetBudget(imaging.Footprint("image/png", one))
	defer restore()
	waits := func(content []byte) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
		defer cancel()
		if _, err := imaging.Decode(ctx, bytes.NewReader(content), "image/png", 1<<20); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("an image beside a full budget = %v, want it to wait out its caller", err)
		}
	}

	first, err := imaging.Decode(t.Context(), bytes.NewReader(gray), "image/png", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	waits(gray)
	first.Release()
	first.Release()

	alone, err := imaging.Decode(t.Context(), bytes.NewReader(deep), "image/png", 1<<20)
	if err != nil {
		t.Fatalf("an image larger than the budget, decoded alone = %v", err)
	}
	waits(gray)
	alone.Release()
	last, err := imaging.Decode(t.Context(), bytes.NewReader(gray), "image/png", 1<<20)
	if err != nil {
		t.Fatalf("an image once the budget is free = %v", err)
	}
	last.Release()
}

// emptyFrame is a GIF whose logical screen is w by h and whose one frame, at its origin, is none of it
// wide and all of it high: Go's decoder takes the frame as fitting the screen, and decodes it to an
// image with no pixels.
func emptyFrame(w, h uint16) []byte {
	b := []byte("GIF89a")
	b = binary.LittleEndian.AppendUint16(b, w)
	b = binary.LittleEndian.AppendUint16(b, h)
	// A global colour table of two, black and white.
	b = append(b, 0x80, 0, 0, 0, 0, 0, 255, 255, 255)
	// The frame: at the origin, 0 wide, h high, with no table of its own.
	b = append(b, 0x2C, 0, 0, 0, 0, 0, 0)
	b = binary.LittleEndian.AppendUint16(b, h)
	// Its pixels: LZW of two bits, a clear code and the end code in one sub-block; then the trailer.
	return append(b, 0, 2, 1, 0x2C, 0, 0x3B)
}

// An image that decodes to no pixels, a GIF whose first frame is none of its screen wide, is refused
// as one that does not decode, and gives its share of the budget back: scaled, it would divide by its
// width, and the files worker scaling it would take the process down with it.
func TestAnImageOfNoPixelsIsRefused(t *testing.T) {
	gif := emptyFrame(10, 5000)
	cfg, _, err := image.DecodeConfig(bytes.NewReader(gif))
	if err != nil {
		t.Fatal(err)
	}
	restore := imaging.SetBudget(imaging.Footprint("image/gif", cfg))
	defer restore()
	for range 2 {
		// The second waits for the whole budget: it is there only if the first gave it back.
		ctx, cancel := context.WithTimeout(t.Context(), time.Second)
		m, err := imaging.Decode(ctx, bytes.NewReader(gif), "image/gif", 1<<20)
		cancel()
		if !errors.Is(err, imaging.ErrEmpty) {
			m.Release()
			t.Fatalf("decode of a frame of no pixels = %v, want ErrEmpty", err)
		}
	}
}

// A decoder that panics on the bytes it is given gives the image's share of the budget back as the
// panic passes: the files workers recover from it and go on, and a share it kept would be gone from
// the budget for good, until nothing could be decoded at all.
func TestADecoderThatPanicsGivesItsShareBack(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, 100, 100))); err != nil {
		t.Fatal(err)
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	restore := imaging.SetBudget(imaging.Footprint("image/png", cfg))
	defer restore()
	restoreDecoder := imaging.SetDecoder("image/png", func(io.Reader) (image.Image, error) { panic("a decoder's bug") })
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("the decoder's panic did not pass")
			}
		}()
		_, _ = imaging.Decode(t.Context(), bytes.NewReader(buf.Bytes()), "image/png", 1<<20)
	}()
	restoreDecoder()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	m, err := imaging.Decode(ctx, bytes.NewReader(buf.Bytes()), "image/png", 1<<20)
	if err != nil {
		t.Fatalf("an image after a decoder panicked = %v, want its share of the budget back", err)
	}
	m.Release()
}

// What is derived carries no metadata: the EXIF segment does not survive, and a transparent image
// stays transparent.
func TestEncodeDropsMetadataAndKeepsTransparency(t *testing.T) {
	m, err := imaging.Decode(t.Context(), bytes.NewReader(photo(t, 20, 20, 6)), "image/jpeg", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Release()
	enc, err := imaging.Encode(m.Fit(10))
	if err != nil {
		t.Fatal(err)
	}
	if enc.ContentType != "image/jpeg" || bytes.Contains(enc.Bytes, []byte("Exif")) {
		t.Fatalf("encoded %s, with EXIF: %v", enc.ContentType, bytes.Contains(enc.Bytes, []byte("Exif")))
	}
	clear := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	enc, err = imaging.Encode(clear)
	if err != nil || enc.ContentType != "image/png" {
		t.Fatalf("a transparent image encoded as %s, %v", enc.ContentType, err)
	}
}
