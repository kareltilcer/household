// Package imaging reads, scales and writes the raster images the platform derives from uploads: a
// file's thumbnail and preview (FR-FL3) and a user's picture. It decodes only what Go reads without
// cgo, refuses an image whose dimensions would take more memory than the process should give one
// (a decompression bomb is a few kilobytes of PNG that decode to gigabytes), turns a photograph the
// way its EXIF orientation says a camera held it, and writes what it derives without the
// original's metadata, so a derived image carries no camera, no time and no place.
package imaging

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"

	"golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	"golang.org/x/image/tiff"
	"golang.org/x/image/webp"
)

var (
	// ErrUnsupported is Decode's answer for bytes of a type it does not read.
	ErrUnsupported = errors.New("imaging: not an image type this server reads")
	// ErrTooLarge is Decode's answer for an image with more pixels than it was allowed.
	ErrTooLarge = errors.New("imaging: the image has too many pixels")
)

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

// Image is a decoded image and what was read about it.
type Image struct {
	image.Image
	// Orientation is the EXIF orientation it was stored with, 1 to 8, 1 for upright or none.
	// Decode has not applied it: Upright does, after the image is scaled, when it costs least.
	Orientation int
}

// Decode reads an image of contentType from r, refusing one of more than maxPixels. A GIF is read
// as its first frame.
func Decode(r io.ReadSeeker, contentType string, maxPixels int) (Image, error) {
	d, ok := decoders[contentType]
	if !ok {
		return Image{}, ErrUnsupported
	}
	cfg, err := d.config(r)
	if err != nil {
		return Image{}, fmt.Errorf("imaging: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > maxPixels/cfg.Height {
		return Image{}, ErrTooLarge
	}
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
	img, err := d.decode(r)
	if err != nil {
		return Image{}, fmt.Errorf("imaging: %w", err)
	}
	return Image{Image: img, Orientation: orientation}, nil
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
	for y := range h {
		for x := range w {
			var dx, dy int
			switch o {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			dst.Set(dx, dy, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
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
