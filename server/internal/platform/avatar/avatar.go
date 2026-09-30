// Package avatar keeps users' pictures (plan item 14): Me.avatar_url, which a user sets for
// themselves, and a child profile's, which its household's owners set. A picture is the account's,
// as the user is (PRD 01 §2.4), so it lives under the account's prefix,
// u/{user_id}/avatar/{id}/picture, and is metered to no household (D-107).
//
// What is kept is not what was uploaded: the upload is decoded, cropped to its centred square,
// scaled to Side pixels, turned upright and written again, so a picture carries no camera, no time
// and no place, whatever the photograph it came from did, and every member's app loads a few
// kilobytes rather than the photograph. A new picture has a new id, and so a new key, which the
// store writes once; the one it replaces is purged once the replacement commits.
//
// A picture's URL is pre-signed, valid for minutes (D-9), and issued in a response to whoever that
// response is for: the user themselves, a member of a household the user is in, or, in the child
// profiles a household's code lists, whoever holds the code.
package avatar

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/imaging"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

const (
	// MaxBytes caps an uploaded picture: a phone's photograph, with room to spare.
	MaxBytes int64 = 20_000_000
	// Side is the side of the square a picture is kept as, in pixels.
	Side = 512
	// maxPixels caps the image a picture is decoded from: the contract's 64 megapixels.
	maxPixels = 64_000_000
)

// Accept takes what the contract's AvatarUpload takes: a JPEG, a PNG, a GIF or a WebP. A HEIC
// photograph is converted by the app before it is sent; a BMP or a TIFF, which this server decodes to
// preview a file, is no picture a phone or a browser sends, and is refused 415 as the contract says.
func Accept(t files.Type) bool { return slices.Contains(pictureTypes, t.MIME) && imaging.Reads(t.MIME) }

// pictureTypes are the types a picture is made from.
var pictureTypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp"}

// Service keeps the pictures.
type Service struct {
	files *files.Service
	store *objectstore.Store
	log   *slog.Logger
	now   func() time.Time
	// purgeLimit bounds Purge: purgeTimeout, but in the test that waits it out.
	purgeLimit time.Duration
}

// New returns the service, which receives uploads through fs and keeps pictures in its store; now
// is the clock the URLs are issued by, time.Now when nil.
func New(fs *files.Service, log *slog.Logger, now func() time.Time) (*Service, error) {
	if fs == nil || log == nil {
		return nil, errors.New("avatar: the service needs the files pipeline and a logger")
	}
	if now == nil {
		now = time.Now
	}
	return &Service{files: fs, store: fs.Store(), log: log, now: now, purgeLimit: purgeTimeout}, nil
}

// Picture is a picture made from an upload, ready to be kept.
type Picture struct {
	ID          uuid.UUID
	ContentType string
	bytes       []byte
	sha256      [32]byte
}

// Key is the object key of user's picture id.
func Key(user, id uuid.UUID) string {
	return fmt.Sprintf("u/%s/avatar/%s/picture", user, id)
}

// Upload reads the picture r carries in its "file" field and makes it into a picture to keep:
// refused as files.Receive refuses a file, 413 over MaxBytes, 415 for a type Accept does not take,
// and 422 naming /file for an image that does not decode or has too many pixels.
func (s *Service) Upload(w http.ResponseWriter, r *http.Request) (Picture, error) {
	u, err := s.files.Receive(w, r, files.Rules{Accept: Accept, MaxBytes: MaxBytes})
	if err != nil {
		return Picture{}, err
	}
	defer func() { _ = u.Close() }()
	// Decoded once the images decoded meanwhile leave room for it (imaging.Budget): a request that
	// gave up waiting is no image that did not decode.
	m, err := imaging.Decode(r.Context(), u.Reader(), u.Type.MIME, maxPixels)
	switch {
	case err != nil && r.Context().Err() != nil:
		return Picture{}, r.Context().Err()
	case err != nil:
		return Picture{}, problem.Validation(problem.FieldError{Field: "/" + files.FileField, Code: problem.FieldInvalid})
	}
	defer m.Release()
	enc, err := imaging.Encode(m.Square(Side))
	if err != nil {
		return Picture{}, err
	}
	return Picture{ID: idgen.New(), ContentType: enc.ContentType, bytes: enc.Bytes, sha256: sha256.Sum256(enc.Bytes)}, nil
}

// Put writes p to the store as user's, before the transaction that records it: a store that cannot
// be reached is 502 storage_unavailable (FR-NF3).
//
// The key is the picture's alone, its id drawn for it, so bytes already there with its digest are
// its own: a write the store kept but whose answer was lost, which the store's client sent again and
// the store refused as a second write to the key. That is the picture put, not an outage.
func (s *Service) Put(ctx context.Context, user uuid.UUID, p Picture) error {
	err := s.store.PutSame(ctx, Key(user, p.ID), bytes.NewReader(p.bytes), int64(len(p.bytes)),
		objectstore.Object{ContentType: p.ContentType, SHA256: p.sha256})
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		s.log.LogAttrs(ctx, slog.LevelWarn, "avatar: the object store refused a picture", slog.Any("error", err))
		return problem.New(http.StatusBadGateway, problem.CodeStorageUnavailable)
	}
	return nil
}

// Set records p as user's picture in tx, and returns the id of the one it replaced, uuid.Nil for
// none, whose object the caller purges once tx commits.
func Set(ctx context.Context, tx pgx.Tx, user uuid.UUID, p Picture) (uuid.UUID, error) {
	old, err := current(ctx, tx, user)
	if err != nil {
		return uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO avatars (user_id, id, content_type, byte_size, sha256) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET id = excluded.id, content_type = excluded.content_type,
		  byte_size = excluded.byte_size, sha256 = excluded.sha256, created_at = now()`,
		user, p.ID, p.ContentType, len(p.bytes), p.sha256[:])
	return old, err
}

// Clear removes user's picture in tx, and returns its id, uuid.Nil for none, whose object the caller
// purges once tx commits.
func Clear(ctx context.Context, tx pgx.Tx, user uuid.UUID) (uuid.UUID, error) {
	old, err := current(ctx, tx, user)
	if err != nil || old == uuid.Nil {
		return old, err
	}
	_, err = tx.Exec(ctx, "DELETE FROM avatars WHERE user_id = $1", user)
	return old, err
}

// current returns the id of user's picture, locked for the rest of tx, uuid.Nil for none.
func current(ctx context.Context, tx pgx.Tx, user uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, "SELECT id FROM avatars WHERE user_id = $1 FOR UPDATE", user).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil
	}
	return id, err
}

// purgeTimeout bounds the removal of a replaced picture. Its callers purge once their change has
// committed and before they answer, and the store's client waits on a store that stops answering for
// as long as it is let: past this, the change is answered, and the picture is left to the sweep.
const purgeTimeout = 10 * time.Second

// Purge removes the object of user's picture id, once the transaction that replaced or cleared it
// has committed; uuid.Nil is none. It runs past the request's end, since the change it follows has
// committed, but for no longer than purgeTimeout. A failure is logged and left to the sweep.
func (s *Service) Purge(ctx context.Context, user, id uuid.UUID) {
	if id == uuid.Nil {
		return
	}
	purging, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.purgeLimit)
	defer cancel()
	if err := s.store.Delete(purging, Key(user, id)); err != nil {
		s.log.LogAttrs(ctx, slog.LevelWarn, "avatar: purge a replaced picture", slog.Any("error", err))
	}
}

// Ref is a picture as a query reads it beside its user: its id and type, both nil for a user who has
// none.
type Ref struct {
	ID          *uuid.UUID
	ContentType *string
}

// Columns select a Ref for the user whose id the expression user names, as a query's two columns.
func Columns(user string) string {
	return "(SELECT a.id FROM avatars a WHERE a.user_id = " + user + "), " +
		"(SELECT a.content_type FROM avatars a WHERE a.user_id = " + user + ")"
}

// URL returns a URL fetching user's picture ref, pre-signed for minutes (D-9), or nil for a user who
// has none. The caller has authorised whoever the response it goes in is for to see the user. A URL
// that cannot be signed, which a key made of two UUIDs never is, is logged and left out.
func (s *Service) URL(ctx context.Context, user uuid.UUID, ref Ref) *string {
	if ref.ID == nil {
		return nil
	}
	contentType := ""
	if ref.ContentType != nil {
		contentType = *ref.ContentType
	}
	url, _, err := s.store.Presign(ctx, Key(user, *ref.ID), objectstore.Presentation{
		ContentType: contentType, Disposition: objectstore.Inline,
	}, s.now())
	if err != nil {
		s.log.LogAttrs(ctx, slog.LevelError, "avatar: sign a picture's URL", slog.Any("error", err))
		return nil
	}
	return &url
}

// Sweep removes the pictures under the accounts' prefix that no user has and that are older than
// files.SweepGrace: one replaced whose purge failed, or one put by an upload whose transaction did
// not commit. pool reads the pictures users have, as the request role; the table is no household's.
// It returns how many it removed. Item 15's scheduler runs it nightly.
func (s *Service) Sweep(ctx context.Context, pool interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
},
) (int, error) {
	rows, err := pool.Query(ctx, "SELECT user_id, id FROM avatars")
	if err != nil {
		return 0, err
	}
	kept := map[string]bool{}
	var user, id uuid.UUID
	if _, err := pgx.ForEachRow(rows, []any{&user, &id}, func() error {
		kept[Key(user, id)] = true
		return nil
	}); err != nil {
		return 0, err
	}
	cutoff := s.now().Add(-files.SweepGrace)
	var keys []string
	if err := s.store.List(ctx, "u/", func(o objectstore.Info) error {
		if strings.Contains(o.Key, "/avatar/") && !kept[o.Key] && o.LastModified.Before(cutoff) {
			keys = append(keys, o.Key)
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return len(keys), s.store.Delete(ctx, keys...)
}
