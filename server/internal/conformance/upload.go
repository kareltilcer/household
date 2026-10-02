package conformance

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/files"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// UploadPath is where an attachment's bytes are uploaded, outside the contract, which names no
// operation of a module it does not know (ADR 0013): {household_id} and {attachment_id} name the
// attachment, whose row a client made pending before (writeAttachment, D-25).
const UploadPath = "/conformance/households/{" + tenant.Param + "}/attachments/{attachment_id}/content"

// uploads serves an attachment's upload: the bytes of a file whose row syncs whatever becomes of
// them (PRD 03 §2.7, D-25, scenario 12).
type uploads struct {
	files *files.Service
	log   *slog.Logger
}

// uploadRoutes returns what registers UploadPath on a router: behind a device's authentication, the
// tenant middleware with its entitlement gate (app.Gate), the module registry the spine checks the
// upload's mutation against, and the module's gate, as a module's route is in the API (app.NewRouter).
func uploadRoutes(s app.Served) (func(chi.Router), error) {
	tenancy, err := tenant.Middleware(tenant.Config{Pool: s.Pool, Logger: s.Log, Entitlement: app.Gate})
	if err != nil {
		return nil, err
	}
	u := uploads{files: s.Files, log: s.Log}
	return func(r chi.Router) {
		r.Group(func(g chi.Router) {
			g.Use(s.Devices.Authenticate, auth.Required, tenancy, mutation.Catalog(s.Catalog), grant.Gate(Name))
			g.Post(UploadPath, u.content)
		})
	}, nil
}

// content receives the bytes of the attachment the path names, through the files pipeline, which
// sniffs, caps and refuses them as it does every upload (FR-FL1), and records them, marking the
// attachment ready. An upload refused for good, a type the pipeline never takes, a file over its cap,
// or a household past its storage or its objects, marks the attachment failed, its reason the
// refusal's code, which a member can act on (D-25), and is answered as the pipeline refused it; the
// row is never lost. A refusal another try may pass, the household's state or an object store out of
// reach, leaves it pending.
func (u uploads) content(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	requestID := reqctx.RequestID(ctx)
	if err := grant.Require(ctx, Name, access.Contribute); err != nil {
		u.write(ctx, w, requestID, err)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "attachment_id"))
	if err != nil {
		problem.Write(w, requestID, problem.NotFound())
		return
	}
	var there bool
	if err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM conformance_attachments WHERE id = $1 AND deleted_at IS NULL)", id).Scan(&there)
	}); err != nil {
		u.write(ctx, w, requestID, err)
		return
	}
	if !there {
		problem.Write(w, requestID, problem.NotFound())
		return
	}
	upload, err := u.files.Receive(w, r, files.Rules{})
	if err != nil {
		u.refused(ctx, w, requestID, id, err)
		return
	}
	defer func() { _ = upload.Close() }()
	stored, err := u.files.Put(ctx, upload, files.Target{Module: Name, Entity: id})
	if err != nil {
		u.refused(ctx, w, requestID, id, err)
		return
	}
	var row AttachmentRow
	_, err = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
		if err := files.Record(ctx, tx, stored, files.Attribution{Owner: tenant.From(ctx).UserID()}); err != nil {
			return mutation.Record{}, err
		}
		return settle(ctx, tx, id, attachmentReady, nil, &row)
	})
	if err != nil {
		u.write(ctx, w, requestID, err)
		return
	}
	u.files.Nudge()
	httpx.WriteJSON(w, http.StatusOK, row)
}

// refused answers err, the files pipeline's refusal of attachment's bytes, marking the attachment
// failed first when no later try can pass it.
func (u uploads) refused(ctx context.Context, w http.ResponseWriter, requestID string, attachment uuid.UUID, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		u.write(ctx, w, requestID, err)
		return
	}
	switch {
	case p.Status == http.StatusRequestEntityTooLarge, p.Status == http.StatusUnsupportedMediaType,
		p.Code == problem.CodeStorageCeilingReached, p.Code == problem.CodeFairUseCeiling:
		reason := string(p.Code)
		var row AttachmentRow
		if _, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
			return settle(ctx, tx, attachment, attachmentFailed, &reason, &row)
		}); err != nil {
			u.write(ctx, w, requestID, err)
			return
		}
	}
	problem.Write(w, requestID, p)
}

// settle marks the pending attachment id status, with reason when it failed, reading it into row, and
// returns what that recorded: nothing when it is not pending, its bytes already ready or failed.
func settle(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string, reason *string, row *AttachmentRow) (mutation.Record, error) {
	a, err := scanAttachment(tx.QueryRow(ctx, `
		UPDATE conformance_attachments SET attachment_status = $2, failure_reason = $3
		WHERE id = $1 AND attachment_status = 'pending' RETURNING `+attachmentColumns, id, status, reason))
	if errors.Is(err, pgx.ErrNoRows) {
		*row, err = scanAttachment(tx.QueryRow(ctx, "SELECT "+attachmentColumns+" FROM conformance_attachments WHERE id = $1", id))
		return mutation.Record{}, err
	}
	if err != nil {
		return mutation.Record{}, err
	}
	*row = a
	return mutation.Record{
		Event:   event("attachment.upload", Attachment, a.ID, map[string]any{"file_name": a.FileName, "status": a.AttachmentStatus}),
		Changes: []sync.Change{{Entity: Attachment, ID: a.ID, Op: sync.Upsert, Version: a.Version, Row: a}},
	}, nil
}

// write answers err: a problem as it is, anything else 500, logged.
func (u uploads) write(ctx context.Context, w http.ResponseWriter, requestID string, err error) {
	var p *problem.Problem
	if errors.As(err, &p) {
		problem.Write(w, requestID, p)
		return
	}
	u.log.LogAttrs(ctx, slog.LevelError, "conformance: an attachment's upload failed", slog.Any("error", err))
	problem.Write(w, requestID, problem.Internal())
}
