package files

import (
	"context"
	"encoding/hex"
	"errors"
	"mime"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Link is the contract's ContentLink: a URL pre-signed for one object, which fetches it for
// minutes (D-9).
type Link struct {
	URL         string                  `json:"url"`
	ExpiresAt   time.Time               `json:"expires_at"`
	ContentType string                  `json:"content_type"`
	ByteSize    int64                   `json:"byte_size"`
	Disposition objectstore.Disposition `json:"disposition"`
	// ETag is the bytes' SHA-256, in hex: they never change, so a client keeps them by it.
	ETag string `json:"etag"`
}

// Link returns a link to the variant of module's entity in ctx's household (FR-FL2). It is issued
// only to a caller who can see the module, and for an entity private to a member, only to those who
// may open it (opens): the member, and, for a child profile's, the household's owners (D-19). A
// module asks for more than seeing before it asks for the link, but no link reaches a caller the
// module is absent for, or a private file they may not open, whoever forgot to ask. Each of those,
// and an object that is not there, is 404, since a 403 would say it exists (D-16).
//
// An active type, HTML or SVG, and anything a browser does not show, is a download, never rendered
// (FR-FL2); a variant is named after the original, with its own type's extension.
func (s *Service) Link(ctx context.Context, module string, entity uuid.UUID, variant string) (Link, error) {
	if err := grant.Require(ctx, module, access.View); err != nil {
		return Link{}, err
	}
	scope := tenant.From(ctx)
	var (
		row         Link
		sha         []byte
		filename    *string
		ownerID     *uuid.UUID
		private     bool
		child       bool
		contentType string
	)
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT f.content_type, f.byte_size, f.sha256, o.filename, o.owner_id, o.private,
			  EXISTS (SELECT FROM memberships m WHERE m.household_id = o.household_id AND m.user_id = o.owner_id AND m.role = 'child')
			FROM files f
			JOIN files o ON o.household_id = f.household_id AND o.module = f.module AND o.entity_id = f.entity_id
			  AND o.variant = 'original'
			WHERE f.household_id = $1 AND f.module = $2 AND f.entity_id = $3 AND f.variant = $4`,
			scope.HouseholdID(), module, entity, variant).Scan(&contentType, &row.ByteSize, &sha, &filename, &ownerID, &private, &child)
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Link{}, problem.NotFound()
	case err != nil:
		return Link{}, err
	case private && !opens(scope, ownerID, child):
		return Link{}, problem.NotFound()
	}
	t := typeOf(contentType)
	name := ""
	if filename != nil {
		name = *filename
		if variant != Original {
			name = strings.TrimSuffix(name, path.Ext(name)) + extension(contentType)
		}
	}
	url, expires, err := s.store.Presign(ctx, Key(scope.HouseholdID(), module, entity, variant), objectstore.Presentation{
		ContentType: contentType, Disposition: t.Disposition(), Filename: name,
	}, s.now())
	if err != nil {
		return Link{}, err
	}
	row.URL, row.ExpiresAt, row.ContentType, row.Disposition = url, expires, contentType, t.Disposition()
	row.ETag = hex.EncodeToString(sha)
	return row, nil
}

// opens reports whether scope's caller may open an entity private to owner, which is a child profile
// of the household when child says so: its owner may, and so may the household's owners when the
// owner is a child profile, whose private items D-19 makes readable by them (FR-CH3), as a module
// shows them the entity itself. An adult's private item is no one else's to open, owners included.
// The storage picture's largest items hold to the same rule (storage.Picture).
func opens(scope *tenant.Scope, owner *uuid.UUID, child bool) bool {
	switch {
	case owner == nil:
		return false
	case *owner == scope.UserID():
		return true
	}
	return child && scope.Role() == access.Owner
}

// typeOf is the type a stored object was sniffed as, from the media type it was stored with.
func typeOf(contentType string) Type {
	base, _, _ := strings.Cut(contentType, ";")
	if t, ok := stored[strings.TrimSpace(base)]; ok {
		return t
	}
	return Type{MIME: contentType, Class: ClassBinary}
}

// extension is the usual extension of contentType, with its dot, "" for none.
func extension(contentType string) string {
	if t := typeOf(contentType); t.Ext != "" {
		return "." + t.Ext
	}
	if exts, _ := mime.ExtensionsByType(contentType); len(exts) > 0 {
		return exts[0]
	}
	return ""
}

// stored are the types Sniff names, by their media type.
var stored = func() map[string]Type {
	out := map[string]Type{}
	add := func(t Type) {
		base, _, _ := strings.Cut(t.MIME, ";")
		if _, ok := out[base]; !ok && t.MIME != "application/octet-stream" {
			out[base] = t
		}
	}
	for _, s := range signatures {
		add(s.typ)
	}
	for _, t := range detectedTypes {
		add(t)
	}
	for _, t := range odfTypes {
		add(t)
	}
	for _, o := range ooxml {
		add(o.typ)
		macro := o.typ
		macro.MIME, macro.Ext = o.macro, o.macroExt
		add(macro)
	}
	for _, t := range cfbClasses {
		add(t)
	}
	for _, t := range cfbStreams {
		add(t)
	}
	for _, t := range textTypes {
		add(t)
	}
	for _, t := range []Type{
		{MIME: "application/pdf", Class: ClassPDF, Ext: "pdf"},
		{MIME: "application/rtf", Class: ClassOffice, Ext: "rtf"},
		{MIME: "image/webp", Class: ClassRaster, Ext: "webp"},
		{MIME: "image/bmp", Class: ClassRaster, Ext: "bmp"},
		{MIME: "image/avif", Class: ClassPicture, Ext: "avif"},
		{MIME: "image/heic", Class: ClassPicture, Ext: "heic"},
		{MIME: "image/heif", Class: ClassPicture, Ext: "heif"},
		{MIME: "video/quicktime", Class: ClassMedia, Ext: "mov"},
		{MIME: "audio/mp4", Class: ClassMedia, Ext: "m4a"},
		{MIME: "video/3gpp", Class: ClassMedia, Ext: "3gp"},
		{MIME: "video/mp4", Class: ClassMedia, Ext: "mp4"},
		{MIME: "image/svg+xml", Class: ClassActive, Ext: "svg"},
		{MIME: "application/x-tar", Class: ClassArchive, Ext: "tar"},
		{MIME: "application/x-bzip2", Class: ClassArchive, Ext: "bz2"},
		{MIME: "text/plain", Class: ClassText, Ext: "txt"},
	} {
		add(t)
	}
	return out
}()
