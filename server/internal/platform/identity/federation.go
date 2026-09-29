package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/device"
	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/mail"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/ratelimit"
	"github.com/kareltilcer/household/server/internal/platform/session"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Signing in with Google or Apple (FR-ID2): the provider's subject is the stable identifier, a
// credential of the account that holds it. A subject no account holds, whose address an account
// has, is never linked on its own: its owner signs in as they always have and links it.

// StateFor is how long a sign-in begun with a provider waits for its callback.
const StateFor = 10 * time.Minute

// providerNames are the providers as an email names them.
var providerNames = map[string]string{federation.Google: "Google", federation.Apple: "Apple"}

// provider is the provider r's path names, and false for one the server is not configured for.
func (s *Service) provider(r *http.Request) (*federation.Provider, string, bool) {
	name := chi.URLParam(r, "provider")
	p, ok := s.Providers[name]
	return p, name, ok && p != nil
}

// oauthStart is postAuthOauthByProviderStart: the provider's authorization URL for a sign-in the
// client begins with its PKCE challenge, returning to a redirect URI the server has registered,
// exactly. The state it carries lasts StateFor and is used once; a start made signed in may be
// completed as a link only by the account that made it.
func (s *Service) oauthStart(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	p, name, ok := s.provider(r)
	if !ok {
		s.fail(w, r, problem.NotFound())
		return
	}
	var req struct {
		RedirectURI   string `json:"redirect_uri"`
		CodeChallenge string `json:"code_challenge"`
		ClientType    string `json:"client_type"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if !slices.Contains(s.RedirectURIs, req.RedirectURI) {
		refusal := problem.New(http.StatusUnprocessableEntity, problem.CodeRedirectUriNotRegistered)
		refusal.Errors = []problem.FieldError{{Field: "/redirect_uri", Code: problem.FieldInvalid}}
		s.fail(w, r, refusal)
		return
	}
	client := req.ClientType
	if client == "" {
		client = clientversion.Web
	}
	if client != clientversion.Web && client != clientversion.Mobile {
		s.fail(w, r, invalid("/client_type", problem.FieldInvalid))
		return
	}
	if wait, err := s.Throttles.Take(ctx, ratelimit.Count{Limit: ratelimit.OAuthStartNetwork, Subject: s.network(r)}); err != nil || wait > 0 {
		s.fail(w, r, refusal(wait, err))
		return
	}
	state, nonce := session.NewToken(), session.NewToken()
	authURL, err := p.AuthURL(ctx, req.RedirectURI, state, nonce, req.CodeChallenge)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var starter *uuid.UUID
	if user, ok := auth.User(ctx); ok {
		starter = &user
	}
	err = tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		now := s.Sessions.Now()
		_, err := tx.Exec(ctx, `
			INSERT INTO oauth_states (id, state_hash, provider, user_id, client_type, redirect_uri, code_challenge, nonce, created_at, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			idgen.New(), session.Hash(state), name, starter, client, req.RedirectURI, req.CodeChallenge, nonce, now, now.Add(StateFor))
		return err
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"authorization_url": authURL, "state": state})
}

// oauthState is a sign-in begun with a provider, as its row keeps it.
type oauthState struct {
	client, redirect, challenge, nonce string
	starter                            *uuid.UUID
}

// spendState spends provider's state in a transaction of its own, whatever then comes of the
// sign-in, so that it is used once, and returns it; false for one that is unknown, expired, used,
// or another provider's.
func (s *Service) spendState(ctx context.Context, provider, state string) (oauthState, bool, error) {
	var st oauthState
	err := tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
		now := s.Sessions.Now()
		return tx.QueryRow(ctx, `
			UPDATE oauth_states SET used_at = $3
			WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > $3
			RETURNING client_type, redirect_uri, code_challenge, nonce, user_id`, session.Hash(state), provider, now).
			Scan(&st.client, &st.redirect, &st.challenge, &st.nonce, &st.starter)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return st, false, nil
	}
	return st, err == nil, err
}

// verifies reports whether verifier is the one whose challenge st was begun with.
func (st oauthState) verifies(verifier string) bool {
	return federation.ValidVerifier(verifier) &&
		subtle.ConstantTimeCompare([]byte(federation.Challenge(verifier)), []byte(st.challenge)) == 1
}

// errLinkRequired is the answer to a sign-in with a subject no account holds, whose address an
// account has.
var errLinkRequired = problem.New(http.StatusConflict, problem.CodeLinkRequired)

// errSubjectTaken rolls back a new account whose subject a sign-in running beside it, with
// another address or none, gave an account first: the sign-in is tried again, and finds that
// account.
var errSubjectTaken = errors.New("identity: the subject was given an account meanwhile")

// oauthCallback is postAuthOauthByProviderCallback (FR-ID2): the code the provider sent back,
// redeemed with the client's verifier, signs in the account whose credential holds the provider's
// subject, as a sign-in with a password does, second step included. A subject no account holds
// makes a new one, unless an account has its address, which is linked only by its owner. Every
// refusal of the flow is one 401, and the client begins again; a provider that turns the server
// away is the server's error (federation.ErrRefused).
func (s *Service) oauthCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	p, name, ok := s.provider(r)
	if !ok {
		s.fail(w, r, problem.NotFound())
		return
	}
	var req struct {
		Code         string      `json:"code"`
		State        string      `json:"state"`
		CodeVerifier string      `json:"code_verifier"`
		Device       *deviceJSON `json:"device"`
		TrustToken   string      `json:"trust_token"`
		DisplayName  string      `json:"display_name"`
		Locale       *string     `json:"locale"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	st, found, err := s.spendState(ctx, name, req.State)
	switch {
	case err != nil:
		s.fail(w, r, err)
		return
	case !found, !st.verifies(req.CodeVerifier):
		s.fail(w, r, invalidCredentials())
		return
	}
	a, err := attemptOf(r, st.client, req.Device, req.TrustToken)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	id, err := p.Exchange(ctx, req.Code, st.redirect, req.CodeVerifier, st.nonce)
	if errors.Is(err, federation.ErrRefused) {
		s.fail(w, r, invalidCredentials())
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	lang := preferredLocale(r)
	if req.Locale != nil {
		if tag, ok := locale(*req.Locale); ok {
			lang = tag
		}
	}
	// The provider's name for the person, cut to the longest an account keeps, which the provider
	// does not hold to; or failing that the one the client was given by Apple, which the contract
	// holds to it.
	called, ok := displayName(id.Name)
	if ok {
		called = cut(called, maxDisplayName)
	} else if called, ok = displayName(req.DisplayName); !ok {
		called = ""
	}
	var adm admission
	for range 2 {
		err = tenant.AccountTx(ctx, s.Pool, uuid.Nil, func(tx pgx.Tx) error {
			user, err := s.federatedAccount(ctx, tx, name, id, called, lang)
			if err != nil {
				return err
			}
			adm, err = s.admit(ctx, tx, r, user, a)
			return err
		})
		if !errors.Is(err, errSubjectTaken) {
			break
		}
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	admitted(w, adm)
}

// federatedAccount returns the account whose credential holds provider's subject id, in tx, or a
// new one made for it: named name, speaking lang, with the address the provider holds, verified
// when the provider verified it. A subject no account holds whose address an account has is
// errLinkRequired, whether or not that account verified the address.
//
// The credential is held until tx ends, as a password sign-in holds its password (unchanged): a
// reset that unlinks it (D-102) waits for the sign-in and then ends what it began, since it ends
// every session and device sign-in, and a reset or an unlink that has deleted it first leaves this
// sign-in nothing to find. An unlink that waits for the sign-in ends nothing it began.
func (s *Service) federatedAccount(ctx context.Context, tx pgx.Tx, provider string, id federation.Identity, name, lang string) (uuid.UUID, error) {
	const holder = "SELECT user_id FROM credentials WHERE type = $1 AND subject = $2 FOR SHARE"
	var user uuid.UUID
	err := tx.QueryRow(ctx, holder, provider, id.Subject).Scan(&user)
	if err == nil || !errors.Is(err, pgx.ErrNoRows) {
		return user, err
	}
	var address *string
	if mail.ValidAddress(id.Email) {
		address = &id.Email
	}
	now := s.Sessions.Now()
	var verified *time.Time
	if address != nil && id.EmailVerified {
		verified = &now
	}
	user = idgen.New()
	var created bool
	err = tx.QueryRow(ctx, `
		INSERT INTO users (id, email, email_verified_at, display_name, locale, created_at) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT ((lower(email))) DO NOTHING RETURNING true`,
		user, address, verified, name, lang, now).Scan(&created)
	if errors.Is(err, pgx.ErrNoRows) {
		// An account has the address. It may be the one a sign-in with this subject running beside
		// this one has just made, whose row the insert waited for: read again, now that it has
		// committed, the subject is that account's, which this sign-in signs in as well.
		var found uuid.UUID
		switch err := tx.QueryRow(ctx, holder, provider, id.Subject).Scan(&found); {
		case errors.Is(err, pgx.ErrNoRows):
			return uuid.Nil, errLinkRequired
		case err != nil:
			return uuid.Nil, err
		}
		return found, nil
	}
	if err != nil {
		return uuid.Nil, err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO credentials (user_id, type, subject) VALUES ($1, $2, $3)
		ON CONFLICT (type, subject) WHERE subject IS NOT NULL DO NOTHING RETURNING true`, user, provider, id.Subject).Scan(&created)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, errSubjectTaken
	}
	return user, err
}

// oauthLink is postAuthOauthByProviderLink (FR-ID2): a start the signed-in account made, completed,
// adds the provider's subject to it as a credential, which then signs it in; the explicit step a
// subject whose address the account has needs. The account's address is told. A link whose session
// a reset ended while the code was redeemed answers 401, and links nothing.
func (s *Service) oauthLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	p, name, ok := s.provider(r)
	if !ok {
		s.fail(w, r, problem.NotFound())
		return
	}
	var req struct {
		Code         string `json:"code"`
		State        string `json:"state"`
		CodeVerifier string `json:"code_verifier"`
	}
	if err := decode(r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	st, found, err := s.spendState(ctx, name, req.State)
	switch {
	case err != nil:
		s.fail(w, r, err)
		return
	case !found || st.starter == nil || *st.starter != user:
		s.fail(w, r, invalid("/state", problem.FieldInvalid))
		return
	case !st.verifies(req.CodeVerifier):
		s.fail(w, r, invalid("/code", problem.FieldInvalid))
		return
	}
	id, err := p.Exchange(ctx, req.Code, st.redirect, req.CodeVerifier, st.nonce)
	if errors.Is(err, federation.ErrRefused) {
		s.fail(w, r, invalid("/code", problem.FieldInvalid))
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	taken := problem.New(http.StatusConflict, problem.CodeIdentityAlreadyLinked)
	var linked bool
	err = tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		// The account's row first, as a reset takes it, and then the sign-in this request came
		// with, which a reset confirmed while the code was redeemed has ended. A reset that proves
		// the address unlinks every provider linked before it (D-102): the link lands before the
		// reset, for it to unlink, or not at all, never after it for whoever it took the account
		// from.
		if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR NO KEY UPDATE", user); err != nil {
			return err
		}
		switch live, err := s.stillSignedIn(ctx, tx, user); {
		case err != nil:
			return err
		case !live:
			return problem.New(http.StatusUnauthorized, problem.CodeUnauthenticated)
		}
		var holder uuid.UUID
		err := tx.QueryRow(ctx, "SELECT user_id FROM credentials WHERE type = $1 AND subject = $2", name, id.Subject).Scan(&holder)
		switch {
		case err == nil && holder != user:
			return taken
		case err == nil:
			// Linked already, by an earlier link whose answer was lost.
			return idempotency.Commit(ctx, tx)
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO credentials (user_id, type, subject) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING RETURNING true`, user, name, id.Subject).Scan(&linked)
		if errors.Is(err, pgx.ErrNoRows) {
			// The account holds another subject of the provider, or another account took this one
			// meanwhile.
			return taken
		}
		if err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if linked {
		s.notice(ctx, user, emailIdentityLinked, i18n.Args{"provider": providerNames[name]})
	}
	w.WriteHeader(http.StatusNoContent)
}

// stillSignedIn reports whether the session or the device's sign-in that authenticated ctx's
// request for user is still live in tx. The request was authenticated before tx began, and a reset
// or signing out everywhere may have ended its credential since.
func (s *Service) stillSignedIn(ctx context.Context, tx pgx.Tx, user uuid.UUID) (bool, error) {
	if d, ok := device.From(ctx); ok {
		return s.Devices.Live(ctx, tx, user, d.Session)
	}
	if id, ok := session.Current(ctx); ok {
		return s.Sessions.Live(ctx, tx, user, id)
	}
	return false, nil
}

// oauthUnlink is deleteAuthOauthByProvider: the provider's credential goes, unless it is the
// account's only one, which would leave it no way to sign in.
func (s *Service) oauthUnlink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := auth.User(ctx)
	name := chi.URLParam(r, "provider")
	err := tenant.AccountTx(ctx, s.Pool, user, func(tx pgx.Tx) error {
		// The account's row, so that two unlinks at once cannot each leave the other's credential
		// the only one, and then both go.
		if _, err := tx.Exec(ctx, "SELECT FROM users WHERE id = $1 FOR NO KEY UPDATE", user); err != nil {
			return err
		}
		var mine, all int
		if err := tx.QueryRow(ctx, "SELECT count(*) FILTER (WHERE type::text = $2), count(*) FROM credentials WHERE user_id = $1",
			user, name).Scan(&mine, &all); err != nil {
			return err
		}
		switch {
		case mine == 0:
			return problem.NotFound()
		case all == mine:
			return problem.New(http.StatusConflict, problem.CodeOnlyCredential)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM credentials WHERE user_id = $1 AND type::text = $2", user, name); err != nil {
			return err
		}
		return idempotency.Commit(ctx, tx)
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
