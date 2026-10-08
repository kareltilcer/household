package identity

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/kareltilcer/household/server/internal/platform/federation"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// What the web client needs of a provider beside the sign-in itself (plan item 25): which
// providers this server signs in with, and somewhere for Apple's answer to land. Apple answers a
// sign-in that asked for an address or a name with a form its own page posts to the redirect URI,
// and the web client is static files, which receive no POST.

const (
	// AppleReturnPath is the route Apple's page posts its form to, under the API's base path: the
	// web client's redirect URI for Apple, and the one unsafe route another site's origin is
	// admitted to (session.Origins.Admitting).
	AppleReturnPath = "/auth/oauth/apple/return"
	// AppleOrigin is the origin Apple's page posts that form from.
	AppleOrigin = "https://appleid.apple.com"
	// routeAppleReturn is the web client's route the form's fields are sent on to, in the fragment.
	routeAppleReturn = "sign-in/apple"
)

// The longest of each field Apple's form may carry, the contract's maxLength: a form is no JSON,
// so the edge has not held it to them.
const (
	maxReturnCode  = 2048
	maxReturnState = 128
	maxReturnUser  = 4096
	maxReturnError = 128
	// maxReturnForm is the most of a form that is read: its fields at their longest, encoded.
	maxReturnForm = 3 * (maxReturnCode + maxReturnState + maxReturnUser + maxReturnError)
)

// oauthProviders is getAuthOauth: the providers the server is configured for, Google before
// Apple, which a client offers and no other.
func (s *Service) oauthProviders(w http.ResponseWriter, _ *http.Request) {
	configured := []string{}
	for _, name := range []string{federation.Google, federation.Apple} {
		if s.Providers[name] != nil {
			configured = append(configured, name)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string][]string{"providers": configured})
}

// appleReturn is postAuthOauthAppleReturn: Apple's form, sent on to the web client with its
// fields in the fragment, which a browser sends to no server. It signs nobody in and spends
// nothing: the page it sends the browser to holds the verifier the code is redeemed with, and the
// state to compare this one against.
func (s *Service) appleReturn(w http.ResponseWriter, r *http.Request) {
	if s.Providers[federation.Apple] == nil {
		s.fail(w, r, problem.NotFound())
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxReturnForm)
	if err := r.ParseForm(); err != nil {
		s.fail(w, r, invalid("", problem.FieldMalformed))
		return
	}
	code, state := r.PostForm.Get("code"), r.PostForm.Get("state")
	user, refusal := r.PostForm.Get("user"), r.PostForm.Get("error")
	for _, field := range []struct {
		name, value string
		longest     int
	}{{"code", code, maxReturnCode}, {"state", state, maxReturnState}, {"user", user, maxReturnUser}, {"error", refusal, maxReturnError}} {
		if utf8.RuneCountInString(field.value) > field.longest {
			s.fail(w, r, invalid("/"+field.name, "max_length"))
			return
		}
	}
	sent := url.Values{}
	switch {
	case refusal != "":
		sent.Set("error", refusal)
	case code != "":
		sent.Set("code", code)
		if name := appleName(user); name != "" {
			sent.Set("name", name)
		}
	default:
		s.fail(w, r, invalid("", problem.FieldInvalid))
		return
	}
	if state != "" {
		sent.Set("state", state)
	}
	// Written out and not set as the URL's Fragment, which escapes a second time what the values'
	// encoding has already escaped.
	target := s.link(routeAppleReturn, "") + "#" + sent.Encode()
	// The page that began the sign-in is the only one that may read what the fragment carries.
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, target, http.StatusSeeOther)
}

// appleName is the person's name in the JSON Apple sends the first time they sign in, as an
// account keeps one, and "" for JSON that is none or names nobody. Apple sends it to the browser
// alone: its ID token carries no name.
func appleName(user string) string {
	if user == "" {
		return ""
	}
	var sent struct {
		Name struct {
			First string `json:"firstName"`
			Last  string `json:"lastName"`
		} `json:"name"`
	}
	if err := json.Unmarshal([]byte(user), &sent); err != nil {
		return ""
	}
	name, ok := displayName(strings.TrimSpace(sent.Name.First + " " + sent.Name.Last))
	if !ok {
		return ""
	}
	return cut(name, maxDisplayName)
}
