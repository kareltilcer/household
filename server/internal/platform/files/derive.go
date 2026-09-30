package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/convert"
	"github.com/kareltilcer/household/server/internal/platform/imaging"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// The sizes of what is derived from an image or a page (FR-FL3): a thumbnail for a list, a preview
// for a page of its own. An image is decoded only up to maxPixels, a 48-megapixel photograph with
// room to spare; a larger one stays download-only.
const (
	thumbnailSide = 320
	previewSide   = 1600
	maxPixels     = 64 << 20
	// maxPage caps the PNG of a page the converter draws.
	maxPage = 32 << 20
)

// variant is one object a job derived.
type variant struct {
	name        string
	contentType string
	body        io.ReadSeeker
	size        int64
	sha256      [32]byte
}

// imageVariant is the variant name of img, encoded.
func imageVariant(name string, img imaging.Encoded) variant {
	return variant{name: name, contentType: img.ContentType, body: bytes.NewReader(img.Bytes), size: int64(len(img.Bytes)),
		sha256: sha256.Sum256(img.Bytes)}
}

// derive derives the variants of j's original, stores them, and records them (FR-FL3): a raster
// image's thumbnail, and its preview where the original is too large or not upright; a PDF's first
// page as a preview and a thumbnail; an office document's PDF, and that PDF's page. It answers
// errPermanent for an original that cannot be decoded or converted, and errGone for one whose
// entity was deleted meanwhile.
func (s *Service) derive(ctx context.Context, j job) error {
	var (
		contentType string
		size        int64
	)
	err := tenant.InTx(s.system(ctx, j.household), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT content_type, byte_size FROM files
			WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original'`,
			j.household, j.module, j.entity).Scan(&contentType, &size)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errGone
	}
	if err != nil {
		return err
	}
	t := typeOf(contentType)
	if !t.Derives() {
		return fmt.Errorf("%w: %s derives nothing", errPermanent, contentType)
	}
	original, err := s.fetch(ctx, Key(j.household, j.module, j.entity, Original))
	if err != nil {
		return err
	}
	defer remove(original)

	var out []variant
	//nolint:exhaustive // Derives is true of these three alone.
	switch t.Class {
	case ClassRaster:
		out, err = rasterVariants(ctx, original, t.MIME)
	case ClassPDF:
		out, err = s.pageVariants(ctx, original, size)
	case ClassOffice:
		out, err = s.officeVariants(ctx, original, size, t.Ext)
	}
	for _, v := range out {
		if f, ok := v.body.(*os.File); ok {
			defer remove(f)
		}
	}
	if err != nil {
		return err
	}
	for i := range out {
		if err := s.putVariant(ctx, j, &out[i]); err != nil {
			return err
		}
	}
	return s.recordVariants(ctx, j, out)
}

// fetch reads the object at key to a temporary file.
func (s *Service) fetch(ctx context.Context, key string) (*os.File, error) {
	body, _, err := s.store.Get(ctx, key)
	if errors.Is(err, objectstore.ErrNotFound) {
		return nil, fmt.Errorf("%w: its original is not in the store", errPermanent)
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = body.Close() }()
	f, err := os.CreateTemp(s.dir, spoolPrefix+"*")
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(f, body); err != nil {
		remove(f)
		return nil, err
	}
	return f, nil
}

// remove closes and removes a temporary file.
func remove(f *os.File) {
	_ = f.Close()
	_ = os.Remove(f.Name())
}

// rasterVariants derives an image's thumbnail, and its preview when it is larger than one, not
// upright, or of a type a browser does not show.
func rasterVariants(ctx context.Context, original io.ReadSeeker, contentType string) ([]variant, error) {
	if _, err := original.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	m, err := decode(ctx, original, contentType)
	if err != nil {
		return nil, err
	}
	defer m.Release()
	thumb, err := imaging.Encode(m.Fit(thumbnailSide))
	if err != nil {
		return nil, err
	}
	out := []variant{imageVariant(Thumbnail, thumb)}
	w, h := m.Size()
	if w > previewSide || h > previewSide || m.Orientation != 1 || contentType == "image/bmp" || contentType == "image/tiff" {
		preview, err := imaging.Encode(m.Fit(previewSide))
		if err != nil {
			return nil, err
		}
		out = append(out, imageVariant(Preview, preview))
	}
	return out, nil
}

// decode decodes an image a job derives from, once the images decoded meanwhile leave room for it
// (imaging.Budget). One that cannot be decoded, or is too large to be, is a permanent failure; a
// job stopped while it waited is not.
func decode(ctx context.Context, r io.ReadSeeker, contentType string) (imaging.Image, error) {
	m, err := imaging.Decode(ctx, r, contentType, maxPixels)
	switch {
	case err == nil:
		return m, nil
	case ctx.Err() != nil:
		return m, ctx.Err()
	}
	return m, fmt.Errorf("%w: %w", errPermanent, err)
}

// pageVariants derives a PDF's first page as a preview and a thumbnail, drawn by the converter.
func (s *Service) pageVariants(ctx context.Context, pdf io.ReadSeeker, size int64) ([]variant, error) {
	if s.convert == nil {
		return nil, fmt.Errorf("%w: no converter", errPermanent)
	}
	if _, err := pdf.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	var page bytes.Buffer
	if err := s.convert.Page(ctx, pdf, size, previewSide, &page, maxPage); err != nil {
		return nil, converted(err)
	}
	m, err := decode(ctx, bytes.NewReader(page.Bytes()), "image/png")
	if err != nil {
		return nil, err
	}
	defer m.Release()
	var out []variant
	for _, v := range []struct {
		name string
		side int
	}{{Preview, previewSide}, {Thumbnail, thumbnailSide}} {
		img, err := imaging.Encode(m.Fit(v.side))
		if err != nil {
			return nil, err
		}
		out = append(out, imageVariant(v.name, img))
	}
	return out, nil
}

// officeVariants derives an office document's PDF, and that PDF's page.
func (s *Service) officeVariants(ctx context.Context, original io.ReadSeeker, size int64, ext string) ([]variant, error) {
	if s.convert == nil {
		return nil, fmt.Errorf("%w: no converter", errPermanent)
	}
	if _, err := original.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(s.dir, spoolPrefix+"*")
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	pdf := variant{name: PDF, contentType: "application/pdf", body: f}
	out := []variant{pdf}
	if err := s.convert.PDF(ctx, original, size, ext, io.MultiWriter(f, h), s.maxBytes); err != nil {
		return out, converted(err)
	}
	info, err := f.Stat()
	if err != nil {
		return out, err
	}
	out[0].size = info.Size()
	copy(out[0].sha256[:], h.Sum(nil))
	pages, err := s.pageVariants(ctx, f, out[0].size)
	return append(out, pages...), err
}

// converted is the converter's failure as a job's: a document it cannot convert is a permanent one.
func converted(err error) error {
	if errors.Is(err, convert.ErrUnconvertible) {
		return fmt.Errorf("%w: %w", errPermanent, err)
	}
	return err
}

// putVariant stores v under its key. Stored already by an attempt that did not record it, it keeps
// the bytes it has, whose digest and size it takes: a conversion need not give the same bytes twice.
func (s *Service) putVariant(ctx context.Context, j job, v *variant) error {
	if _, err := v.body.Seek(0, io.SeekStart); err != nil {
		return err
	}
	key := Key(j.household, j.module, j.entity, v.name)
	err := s.store.PutOnce(ctx, key, v.body, v.size, objectstore.Object{ContentType: v.contentType, SHA256: v.sha256})
	if !errors.Is(err, objectstore.ErrExists) {
		return err
	}
	info, err := s.store.Head(ctx, key)
	if err != nil {
		return err
	}
	v.size, v.contentType = info.Size, info.ContentType
	if info.HasSHA256 {
		v.sha256 = info.SHA256
	}
	return nil
}

// recordVariants records j's variants, attributed as their original is, and marks the original's
// variants ready. When the entity was deleted meanwhile, it removes what it stored instead.
func (s *Service) recordVariants(ctx context.Context, j job, out []variant) error {
	gone := false
	err := tenant.InWriteTx(s.system(ctx, j.household), func(tx pgx.Tx) error {
		var (
			ownerID any
			private bool
		)
		err := tx.QueryRow(ctx, `
			SELECT owner_id, private FROM files
			WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original' FOR UPDATE`,
			j.household, j.module, j.entity).Scan(&ownerID, &private)
		if errors.Is(err, pgx.ErrNoRows) {
			gone = true
			return nil
		}
		if err != nil {
			return err
		}
		for _, v := range out {
			if _, err := tx.Exec(ctx, `
				INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, owner_id, private)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT DO NOTHING`,
				j.household, j.module, j.entity, v.name, v.contentType, v.size, v.sha256[:], ownerID, private); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `
			UPDATE files SET variants = 'ready' WHERE household_id = $1 AND module = $2 AND entity_id = $3 AND variant = 'original'`,
			j.household, j.module, j.entity)
		return err
	})
	if err != nil || !gone {
		return err
	}
	keys := make([]string, len(out))
	for i, v := range out {
		keys[i] = Key(j.household, j.module, j.entity, v.name)
	}
	if err := s.store.Delete(ctx, keys...); err != nil {
		return err
	}
	return errGone
}
