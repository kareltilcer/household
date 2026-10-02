package conformance

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/app"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/token"
)

// Around adds to the API the suite runs against what only the suite needs, beside the API's own
// routes, which it serves as they are:
//
//	GET  /conformance/healthz   200 once the API serves
//	POST /conformance/sign-in   a device's access token for a user the suite made
//	POST /conformance/households/{household_id}/attachments/{attachment_id}/content
//	                            an attachment's bytes (upload.go)
//
// The sign-in stands in for a device's (item 9): the suite's members have no address, no password
// and no second step, and it trusts the user id it is given. It signs a new device of theirs in,
// as a device's sign-in does (device.Store.SignIn), and answers the access token, which the API
// then authenticates as any device's; for as long as the request asks, up to an access token's
// lifetime, so that the suite sees its connector renew a credential the push refuses. It is the
// suite's, served by cmd/conformance-api alone, which is never deployed. keys sign the tokens, the
// API's own.
func Around(keys *token.Keys) app.Around {
	return func(router http.Handler, s app.Served) (http.Handler, error) {
		uploads, err := uploadRoutes(s)
		if err != nil {
			return nil, err
		}
		root := chi.NewRouter()
		root.Use(httpx.RequestScope)
		root.Get("/conformance/healthz", func(w http.ResponseWriter, _ *http.Request) {
			httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})
		root.Post("/conformance/sign-in", signIn(s, keys, time.Now))
		uploads(root)
		root.Mount("/", router)
		return root, nil
	}
}

type signInRequest struct {
	UserID uuid.UUID `json:"user_id"`
	// TTLSeconds is the access token's lifetime, token.Lifetime when zero, and never longer.
	TTLSeconds int `json:"ttl_seconds"`
}

type signInResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

func signIn(s app.Served, keys *token.Keys, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var body signInRequest
		err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
		ttl := time.Duration(body.TTLSeconds) * time.Second
		if err != nil || body.UserID == uuid.Nil || ttl < 0 || ttl > token.Lifetime {
			problem.Write(w, reqctx.RequestID(ctx), problem.Validation(problem.FieldError{Field: "", Code: problem.FieldMalformed}))
			return
		}
		if ttl == 0 {
			ttl = token.Lifetime
		}
		var sid uuid.UUID
		err = tenant.AccountTx(ctx, s.Pool, body.UserID, func(tx pgx.Tx) error {
			var err error
			sid, _, err = s.Devices.SignIn(ctx, tx, body.UserID, device.Info{ID: idgen.New(), Label: "conformance"})
			return err
		})
		if err != nil {
			problem.Write(w, reqctx.RequestID(ctx), problem.Internal())
			return
		}
		// Issued as far in the past as makes it expire after ttl.
		issued := now().Add(ttl - token.Lifetime)
		signed, err := keys.Issue(body.UserID, sid, issued)
		if err != nil {
			problem.Write(w, reqctx.RequestID(ctx), problem.Internal())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, signInResponse{Token: signed, ExpiresAt: issued.Truncate(time.Second).Add(token.Lifetime).UTC()})
	}
}
