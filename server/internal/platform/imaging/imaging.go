// Package imaging reads, scales and writes the raster images the platform derives from uploads: a
// file's thumbnail and preview (FR-FL3) and a user's picture. It decodes only what Go reads without
// cgo, refuses an image whose dimensions would take more memory than the process should give one
// (a decompression bomb is a few kilobytes of PNG that decode to gigabytes), holds the images it
// decodes at once to a budget of memory between them (Budget), turns a photograph the way its EXIF
// orientation says a camera held it, and writes what it derives without the original's metadata, so
// a derived image carries no camera, no time and no place.
package imaging

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"sync"

	"golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	"golang.org/x/image/tiff"
	"golang.org/x/image/webp"
	"golang.org/x/sync/semaphore"
)

var (
	// ErrUnsupported is Decode's answer for bytes of a type it does not read.
	ErrUnsupported = errors.New("imaging: not an image type this server reads")
	// ErrTooLarge is Decode's answer for an image with more pixels than it was allowed.
	ErrTooLarge = errors.New("imaging: the image has too many pixels")
	// ErrEmpty is Decode's answer for an image of no pixels at all, as its header says or as it
	// decodes.
	ErrEmpty = errors.New("imaging: the image has no pixels")
)

// Budget is the memory the images decoded at once, in every request and every files worker of the
// process, may hold between them, in bytes. Each request decodes its own upload, and a PNG of a few
// hundred kilobytes may decode to half a gigabyte: without a bound shared by all of them, a handful
// of such uploads sent at once would take the process's memory, whatever each one's pixel cap. An
// image waits until the others leave it room (Image.Release). The pixel caps keep every image the
// platform takes within it but a CMYK JPEG of more than 53 million pixels, which waits for all of it
// and is decoded alone: the pixel cap, not the budget, is what the contract promises.
const Budget int64 = 1 << 30

// budget is the budget in force, Budget but in the test that fills a smaller one, and decoding what
// it has left.
var (
	budget   = Budget
	decoding = semaphore.NewWeighted(Budget)
)

// footprint is the most memory decoding an image of cfg, in contentType, holds at once, in bytes:
// its pixels at the depth of its colour model, and as much again for what a decoder keeps beside
// them (an interlaced PNG's passes, a lossless WebP's pixels before they are converted); for a JPEG,
// in place of that, four bytes a pixel for each of its components, the coefficients a progressive
// JPEG keeps, which its header does not say it is.
func footprint(contentType string, cfg image.Config) int64 {
	depth, components := int64(8), int64(4)
	if _, paletted := cfg.ColorModel.(color.Palette); paletted {
		depth, components = 1, 1
	} else {
		switch cfg.ColorModel {
		case color.GrayModel, color.AlphaModel:
			depth, components = 1, 1
		case color.Gray16Model, color.Alpha16Model:
			depth, components = 2, 1
		case color.YCbCrModel:
			depth, components = 3, 3
		case color.RGBAModel, color.NRGBAModel, color.CMYKModel, color.NYCbCrAModel:
			depth, components = 4, 4
		}
	}
	pixels := int64(cfg.Width) * int64(cfg.Height)
	if contentType == "image/jpeg" {
		return pixels * (depth + 4*components)
	}
	return pixels * 2 * depth
}

// decoders are the formats Decode reads, by the content type the files pipeline sniffs.
var decoders = map[string]struct {
	decode func(io.Reader) (image.Image, error)
	config func(io.Reader) (image.Config, error)
}{
	"image/jpeg": {jpeg.Decode, jpeg.DecodeConfig},
	"image/png":  {png.Decode, png.DecodeConfig},
	"image/gif":  {gif.Decode, gif.DecodeConfig},
	"image/webp": {webp.Decode, webp.DecodeConfig},
	"image/bmp":  {bmp.Decode, bmp.DecodeConfig},
	"image/tiff": {tiff.Decode, tiff.DecodeConfig},
}

// Reads reports whether Decode reads images of contentType.
func Reads(contentType string) bool {
	_, ok := decoders[contentType]
	return ok
}

// Image is a decoded image and what was read about it. It holds its share of Budget until its holder
// releases it.
type Image struct {
	image.Image
	// Orientation is the EXIF orientation it was stored with, 1 to 8, 1 for upright or none.
	// Decode has not applied it: Upright does, after the image is scaled, when it costs least.
	Orientation int
	release     func()
}

// Release gives back the share of Budget the image holds, once its holder is done with it and with
// what it read from it: every image Decode returns is released, and releasing one twice releases it
// once.
func (m Image) Release() {
	if m.release != nil {
		m.release()
	}
}

// Decode reads an image of contentType from r, refusing one of more than maxPixels, and one that
// decodes to no pixels. It waits, for as long as ctx lets it, until the images decoded meanwhile
// leave room for this one in Budget; the caller releases what it returns. A GIF is read as its first
// frame.
//
// The dimensions a format's header gives are not always those of what it decodes to: a GIF's are
// its logical screen's, and its first frame may lie anywhere within it, as little as none of it wide
// or high. Such a frame decodes without error to an image with no pixels, which nothing can be
// scaled from or cut a square of, so it is refused as an image that does not decode: scaled, it
// would divide by its width.
func Decode(ctx context.Context, r io.ReadSeeker, contentType string, maxPixels int) (Image, error) {
	d, ok := decoders[contentType]
	if !ok {
		return Image{}, ErrUnsupported
	}
	cfg, err := d.config(r)
	if err != nil {
		return Image{}, fmt.Errorf("imaging: %w", err)
	}
	switch {
	case cfg.Width <= 0 || cfg.Height <= 0:
		// A header of no width or height, a GIF's screen of none, has no pixels to decode, and is no
		// image too large to: said to be one, it would send an operator after a bomb that is not there.
		return Image{}, ErrEmpty
	case cfg.Width > maxPixels/cfg.Height:
		return Image{}, ErrTooLarge
	}
	need, held := min(footprint(contentType, cfg), budget), decoding
	orientation := 1
	if contentType == "image/jpeg" {
		if _, err := r.Seek(0, io.SeekStart); err != nil {
			return Image{}, err
		}
		orientation = exifOrientation(r)
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return Image{}, err
	}
	if err := held.Acquire(ctx, need); err != nil {
		return Image{}, err
	}
	release := sync.OnceFunc(func() { held.Release(need) })
	// The share goes back unless the image is handed on, a decoder's panic on bytes a member sent
	// included: the files workers recover from one and go on, and a share it kept would be gone from
	// the budget for as long as the process lives, until nothing could be decoded at all.
	kept := false
	defer func() {
		if !kept {
			release()
		}
	}()
	img, err := d.decode(r)
	switch {
	case err != nil:
		return Image{}, fmt.Errorf("imaging: %w", err)
	case img.Bounds().Empty():
		return Image{}, ErrEmpty
	}
	kept = true
	return Image{Image: img, Orientation: orientation, release: release}, nil
}

// Size is the image's width and height as it is to be seen, its orientation applied.
func (m Image) Size() (w, h int) {
	b := m.Bounds()
	if m.Orientation >= 5 {
		return b.Dy(), b.Dx()
	}
	return b.Dx(), b.Dy()
}

// Fit returns the image scaled to fit within max by max as it is to be seen, and upright. One that
// fits already is only turned upright; none is enlarged.
func (m Image) Fit(maxSide int) image.Image {
	w, h := m.Size()
	if w <= maxSide && h <= maxSide {
		return upright(m.Image, m.Orientation)
	}
	tw, th := maxSide, h*maxSide/w
	if h > w {
		tw, th = w*maxSide/h, maxSide
	}
	if m.Orientation >= 5 {
		tw, th = th, tw
	}
	return upright(scale(m.Image, m.Bounds(), max(tw, 1), max(th, 1)), m.Orientation)
}

// Square returns the largest centred square of the image as it is to be seen, scaled to side by
// side and upright: a picture for a round frame.
func (m Image) Square(side int) image.Image {
	b := m.Bounds()
	s := min(b.Dx(), b.Dy())
	x, y := b.Min.X+(b.Dx()-s)/2, b.Min.Y+(b.Dy()-s)/2
	side = min(side, s)
	return upright(scale(m.Image, image.Rect(x, y, x+s, y+s), side, side), m.Orientation)
}

// scale draws the part sr of src at w by h. A large reduction goes in two steps, a cheap one to
// twice the target and a careful one from there, which is close to the careful one's quality at a
// fraction of its cost on a phone's photograph.
func scale(src image.Image, sr image.Rectangle, w, h int) image.Image {
	if sr.Dx() > 4*w && sr.Dy() > 4*h {
		mid := image.NewNRGBA(image.Rect(0, 0, 2*w, 2*h))
		draw.ApproxBiLinear.Scale(mid, mid.Bounds(), src, sr, draw.Src, nil)
		src, sr = mid, mid.Bounds()
	}
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, sr, draw.Src, nil)
	return dst
}

// upright turns src as EXIF orientation o says: 2 mirrored, 3 turned half round, 4 flipped, 5
// transposed, 6 turned a quarter clockwise, 7 transversed, 8 turned a quarter anticlockwise.
//
// What it turns is nearly always NRGBA, the scaled image Fit and Square draw, and most phone
// photographs are stored turned a quarter: such an image's pixels are copied as they are, four bytes
// each, rather than each read as a colour and converted back, which for a preview's two and a half
// million pixels is as many allocations. Any other image goes through its colour model.
func upright(src image.Image, o int) image.Image {
	if o < 2 || o > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	nrgba, direct := src.(*image.NRGBA)
	for y := range h {
		for x := range w {
			dx, dy := turned(o, x, y, w, h)
			if direct {
				from, to := nrgba.PixOffset(b.Min.X+x, b.Min.Y+y), dst.PixOffset(dx, dy)
				copy(dst.Pix[to:to+4], nrgba.Pix[from:from+4])
				continue
			}
			dst.Set(dx, dy, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

// turned is where orientation o puts the pixel at x, y of a w by h image, 2 to 8 as upright takes
// them.
func turned(o, x, y, w, h int) (dx, dy int) {
	switch o {
	case 2:
		return w - 1 - x, y
	case 3:
		return w - 1 - x, h - 1 - y
	case 4:
		return x, h - 1 - y
	case 5:
		return y, x
	case 6:
		return h - 1 - y, x
	case 7:
		return h - 1 - y, w - 1 - x
	case 8:
		return y, w - 1 - x
	}
	return x, y
}

// Encoded is an image as Encode wrote it.
type Encoded struct {
	Bytes       []byte
	ContentType string
}

// Encode writes img as a PNG when any of it is transparent, which a JPEG would fill black, and as a
// JPEG otherwise, which is what a photograph compresses to. Neither carries metadata.
func Encode(img image.Image) (Encoded, error) {
	var buf bytes.Buffer
	if opaque(img) {
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 82}); err != nil {
			return Encoded{}, fmt.Errorf("imaging: %w", err)
		}
		return Encoded{Bytes: buf.Bytes(), ContentType: "image/jpeg"}, nil
	}
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img); err != nil {
		return Encoded{}, fmt.Errorf("imaging: %w", err)
	}
	return Encoded{Bytes: buf.Bytes(), ContentType: "image/png"}, nil
}

// opaque reports whether every pixel of img is opaque.
func opaque(img image.Image) bool {
	if o, ok := img.(interface{ Opaque() bool }); ok {
		return o.Opaque()
	}
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a != 0xffff {
				return false
			}
		}
	}
	return true
}

// exifOrientation reads the orientation a JPEG's EXIF segment records, 1 when it records none or
// cannot be read: the image is then shown as it was stored.
func exifOrientation(r io.Reader) int {
	var marker [2]byte
	if _, err := io.ReadFull(r, marker[:]); err != nil || marker != [2]byte{0xFF, 0xD8} {
		return 1
	}
	for {
		var seg [4]byte
		if _, err := io.ReadFull(r, seg[:]); err != nil || seg[0] != 0xFF {
			return 1
		}
		length := int(binary.BigEndian.Uint16(seg[2:])) - 2
		// Start of scan, or a marker with no length: the headers are over.
		if seg[1] == 0xDA || seg[1] == 0xD9 || length < 0 {
			return 1
		}
		body := make([]byte, length)
		if _, err := io.ReadFull(r, body); err != nil {
			return 1
		}
		if seg[1] == 0xE1 && len(body) > 6 && string(body[:6]) == "Exif\x00\x00" {
			return tiffOrientation(body[6:])
		}
	}
}

// tiffOrientation reads tag 0x0112 of the first IFD of a TIFF header.
func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(t[4:]))
	if ifd < 8 || ifd+2 > len(t) {
		return 1
	}
	n := int(order.Uint16(t[ifd:]))
	for i := range n {
		e := ifd + 2 + 12*i
		if e+12 > len(t) {
			return 1
		}
		if order.Uint16(t[e:]) == 0x0112 {
			if o := int(order.Uint16(t[e+8:])); o >= 1 && o <= 8 {
				return o
			}
			return 1
		}
	}
	return 1
}
