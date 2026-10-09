package app_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kareltilcer/household/server/internal/app/apptest"
	"github.com/kareltilcer/household/server/internal/platform/clientversion"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/problem"
)

// The tests in this file serve the household's clients and their versions (plan item 27, FR-HA18,
// ADR 0028) through the whole router, against the committed contract: replicas report themselves as
// a browser's and a phone's do, each naming its client in Household-Client, and an owner reads them.

// clientDoc is the contract's Client, as a client reads it.
type clientDoc struct {
	ReplicaID uuid.UUID `json:"replica_id"`
	Member    struct {
		UserID         uuid.UUID `json:"user_id"`
		Label          string    `json:"label"`
		IsFormerMember bool      `json:"is_former_member"`
	} `json:"member"`
	Type       *string   `json:"type"`
	Platform   *string   `json:"platform"`
	Label      string    `json:"label"`
	Version    *string   `json:"version"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// clientsDoc is the contract's ClientList.
type clientsDoc struct {
	Items    []clientDoc `json:"items"`
	Minimums struct {
		Web    *string `json:"web"`
		Mobile *string `json:"mobile"`
	} `json:"minimum_versions"`
}

// clients reads household h's clients, and expects to.
func (b *browser) clients(h uuid.UUID) clientsDoc {
	b.s.t.Helper()
	rec := b.get(householdPath(h, "/clients"))
	expect(b.s.t, rec, http.StatusOK, "")
	var list clientsDoc
	decode(b.s.t, rec, &list)
	return list
}

// reportOf is the report of replica that holds nothing and has nothing queued: what a client that
// has just opened a household sends.
func reportOf(t *testing.T, replica uuid.UUID) string {
	t.Helper()
	return jsonBody(t, map[string]any{
		"replica_id": replica, "checkpoint": "42",
		"health":  map[string]int{"pending_mutations": 0, "unresolved": 0, "checksum_failures": 0},
		"entries": []any{},
	})
}

// report sends replica's report of household h from the browser, naming itself client in
// Household-Client, or no client when it is "", and expects it kept.
func (b *browser) report(h, replica uuid.UUID, client string) {
	b.s.t.Helper()
	req := request{method: http.MethodPost, path: householdPath(h, "/sync/digest"), body: reportOf(b.s.t, replica)}
	if client != "" {
		req.header = http.Header{clientversion.Header: {client}}
	}
	expect(b.s.t, b.send(req), http.StatusOK, "")
}

// report sends replica's report of household h from the phone, which names itself by its version.
func (p *phone) report(h, replica uuid.UUID) *httptest.ResponseRecorder {
	p.s.t.Helper()
	return p.send(http.MethodPost, householdPath(h, "/sync/digest"), reportOf(p.s.t, replica), nil)
}

// text is s, or "null" for none.
func text(s *string) string {
	if s == nil {
		return "null"
	}
	return *s
}

// firefox is the User-Agent Petr's browser signs in with.
const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0"

// An owner reads the household's clients (FR-HA18): each replica that reported itself in it, every
// member's, with the client its last report named, its type and its version as sent, a device's
// platform and label and a browser's User-Agent, whose it is and when it last reported, the one
// that reported last first. A report from the same replica names its client anew, so an app updated
// since is listed at its new version; one that names no client is listed without. A member and a
// child are answered 404, as on billing, and so is everyone while the household is suspended. A
// member's clients leave the list with their membership.
func TestAnOwnerReadsTheHouseholdsClients(t *testing.T) {
	minimum, _ := clientversion.ParseVersion("1.6.0")
	s := newSite(t, apptest.Options{MinClients: clientversion.Minimums{clientversion.Mobile: minimum}})
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	janaID := jana.me().ID
	petr, petrID := s.joined(jana, h.ID, "Petr", s.a("petr@tilcerovi.cz"), "member", nil)
	adam := jana.child(h.ID, "Adam", "1234", nil)

	// Nothing has reported yet: no client, and the minimums the deployment sets, the phone's alone.
	list := jana.clients(h.ID)
	if len(list.Items) != 0 || list.Minimums.Web != nil || text(list.Minimums.Mobile) != "1.6.0" {
		t.Fatalf("before any report: %+v, minimums web %s and mobile %s", list.Items, text(list.Minimums.Web), text(list.Minimums.Mobile))
	}

	// Petr's browser, signed in as a browser names itself, and his phone; Adam's phone; and Jana's
	// own browser, whose report names no client.
	laptop := s.browser()
	expect(t, laptop.send(request{method: http.MethodPost, path: "/auth/login",
		body:   jsonBody(t, map[string]string{"email": s.a("petr@tilcerovi.cz"), "password": passphrase, "client_type": "web"}),
		header: http.Header{"User-Agent": {firefox}}}), http.StatusOK, "")
	inBrowser, onPhone, onAdams, unnamed := idgen.New(), idgen.New(), idgen.New(), idgen.New()
	laptop.report(h.ID, inBrowser, "web/0.1.0+008f0f94379a5b41")
	pixel := s.phone("Petr's phone")
	pixel.version = "1.7.2"
	expect(t, pixel.login(s.a("petr@tilcerovi.cz"), passphrase), http.StatusOK, "")
	expect(t, pixel.report(h.ID, onPhone), http.StatusOK, "")
	tablet := s.phone("")
	tablet.version = "1.6.0"
	expect(t, tablet.childLogin(h.JoinCode, adam.UserID, "1234"), http.StatusOK, "")
	expect(t, tablet.report(h.ID, onAdams), http.StatusOK, "")
	jana.report(h.ID, unnamed, "")
	// Each an hour before the one after it, the last an hour ago: the order is the reports', whatever
	// the clock's resolution, and a later report is later than all of them.
	for i, replica := range []uuid.UUID{unnamed, onAdams, onPhone, inBrowser} {
		if _, err := s.admin.Exec(t.Context(), "UPDATE sync_replicas SET reported_at = reported_at - make_interval(hours => $2) WHERE id = $1",
			replica, i+1); err != nil {
			t.Fatal(err)
		}
	}

	list = jana.clients(h.ID)
	type row struct {
		replica, member        uuid.UUID
		name, kind, platform   string
		label, version         string
		former                 bool
		reported, lastReported time.Time
	}
	read := func(list clientsDoc) []row {
		t.Helper()
		var out []row
		for _, c := range list.Items {
			r := row{replica: c.ReplicaID, member: c.Member.UserID, name: c.Member.Label, kind: text(c.Type), platform: text(c.Platform),
				label: c.Label, version: text(c.Version), former: c.Member.IsFormerMember, reported: c.LastSeenAt}
			if err := s.admin.QueryRow(t.Context(), "SELECT reported_at FROM sync_replicas WHERE id = $1", c.ReplicaID).Scan(&r.lastReported); err != nil {
				t.Fatal(err)
			}
			out = append(out, r)
		}
		return out
	}
	want := []row{
		{replica: unnamed, member: janaID, name: "Jana", kind: "null", platform: "null", label: "", version: "null"},
		{replica: onAdams, member: adam.UserID, name: "Adam", kind: "mobile", platform: "ios", label: "", version: "1.6.0"},
		{replica: onPhone, member: petrID, name: "Petr", kind: "mobile", platform: "ios", label: "Petr's phone", version: "1.7.2"},
		{replica: inBrowser, member: petrID, name: "Petr", kind: "web", platform: "null", label: firefox, version: "0.1.0+008f0f94379a5b41"},
	}
	check := func(what string, got, want []row) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("%s: %d clients, want %d: %+v", what, len(got), len(want), got)
		}
		for i, g := range got {
			if !g.reported.Equal(g.lastReported) || g.reported.IsZero() {
				t.Errorf("%s: client %d was last seen at %s, and last reported at %s", what, i, g.reported, g.lastReported)
			}
			g.reported, g.lastReported = time.Time{}, time.Time{}
			if g != want[i] {
				t.Errorf("%s: client %d is %+v, want %+v", what, i, g, want[i])
			}
		}
	}
	check("the household's clients", read(list), want)

	// Petr's phone is updated, and its replica reports again: the same client, at its new version, and
	// the one that reported last.
	pixel.version = "1.8.0-beta.1"
	expect(t, pixel.report(h.ID, onPhone), http.StatusOK, "")
	want[2].version = "1.8.0-beta.1"
	check("after the phone's update", read(jana.clients(h.ID)), []row{want[2], want[0], want[1], want[3]})

	// An owner's to read, and nobody else's: a member and a child are answered as on billing.
	expect(t, petr.get(householdPath(h.ID, "/clients")), http.StatusNotFound, problem.CodeNotFound)
	expect(t, tablet.send(http.MethodGet, householdPath(h.ID, "/clients"), "", nil), http.StatusNotFound, problem.CodeNotFound)
	// Nor a signed-out caller's, nor a stranger's.
	expect(t, s.browser().get(householdPath(h.ID, "/clients")), http.StatusUnauthorized, problem.CodeUnauthenticated)
	eva := s.person("Eva", s.a("eva@novakovi.cz"))
	expect(t, eva.get(householdPath(h.ID, "/clients")), http.StatusNotFound, problem.CodeNotFound)

	// A suspended household answers nothing, this among it.
	s.suspension(h.ID, true)
	expect(t, jana.get(householdPath(h.ID, "/clients")), http.StatusNotFound, problem.CodeNotFound)
	s.suspension(h.ID, false)

	// Petr is removed: his clients go with his membership, and the others' stay.
	expect(t, jana.delete(householdPath(h.ID, "/members/"+petrID.String())), http.StatusNoContent, "")
	check("after Petr's removal", read(jana.clients(h.ID)), []row{want[0], want[1]})
}

// A household's clients are its own (isolation): a replica that reported in another household is
// listed there and nowhere else, the same member's among them, since a client is listed where it
// synced and not wherever its member belongs.
func TestAHouseholdsClientsAreItsOwn(t *testing.T) {
	s := newSite(t, apptest.Options{})
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	home, cottage := jana.create("Tilcerovi"), jana.create("Chalupa")
	eva := s.person("Eva", s.a("eva@novakovi.cz"))
	theirs := eva.create("Novákovi")

	atHome, atTheCottage, evas := idgen.New(), idgen.New(), idgen.New()
	jana.report(home.ID, atHome, "web/0.1.0")
	jana.report(cottage.ID, atTheCottage, "web/0.1.0")
	eva.report(theirs.ID, evas, "web/0.2.0")

	for _, c := range []struct {
		what    string
		reader  *browser
		h       uuid.UUID
		replica uuid.UUID
		version string
	}{
		{"Jana's home", jana, home.ID, atHome, "0.1.0"},
		{"Jana's cottage", jana, cottage.ID, atTheCottage, "0.1.0"},
		{"Eva's household", eva, theirs.ID, evas, "0.2.0"},
	} {
		list := c.reader.clients(c.h)
		if len(list.Items) != 1 || list.Items[0].ReplicaID != c.replica || text(list.Items[0].Version) != c.version {
			t.Errorf("%s lists %+v, want its own replica %s alone", c.what, list.Items, c.replica)
		}
		// This deployment sets no minimum: there is none to read.
		if list.Minimums.Web != nil || list.Minimums.Mobile != nil {
			t.Errorf("%s reads the minimums web %s and mobile %s, want none", c.what, text(list.Minimums.Web), text(list.Minimums.Mobile))
		}
	}
	// A replica's id is its household's: the same id reported in another household is another client.
	eva.report(theirs.ID, atHome, "web/0.2.0")
	if list := jana.clients(home.ID); len(list.Items) != 1 || list.Items[0].Member.Label != "Jana" {
		t.Errorf("Jana's home lists %+v after Eva reported a replica of its id elsewhere", list.Items)
	}
	if list := eva.clients(theirs.ID); len(list.Items) != 2 {
		t.Errorf("Eva's household lists %+v, want its two", list.Items)
	}
}

// The minimums an owner reads are the ones the deployment refuses under, each as MAJOR.MINOR.PATCH.
func TestTheClientsNameTheMinimumsTheDeploymentSets(t *testing.T) {
	web, _ := clientversion.ParseVersion("0.3.0")
	mobile, _ := clientversion.ParseVersion("2.0.1")
	s := newSite(t, apptest.Options{MinClients: clientversion.Minimums{clientversion.Web: web, clientversion.Mobile: mobile}})
	jana := s.person("Jana", s.a("jana@tilcerovi.cz"))
	h := jana.create("Tilcerovi")
	list := jana.clients(h.ID)
	if text(list.Minimums.Web) != "0.3.0" || text(list.Minimums.Mobile) != "2.0.1" {
		t.Errorf("the minimums read web %s and mobile %s, want 0.3.0 and 2.0.1", text(list.Minimums.Web), text(list.Minimums.Mobile))
	}
	// A client at the minimum is served, and listed once it reports; one below is refused before it
	// could report, so no client is ever listed below the minimum it was refused under.
	replica := idgen.New()
	jana.report(h.ID, replica, "web/0.3.0+abc")
	rec := jana.send(request{method: http.MethodPost, path: householdPath(h.ID, "/sync/digest"), body: reportOf(t, replica),
		header: http.Header{clientversion.Header: {"web/0.2.9"}}})
	expect(t, rec, http.StatusBadRequest, problem.CodeUpdateRequired)
	if list := jana.clients(h.ID); len(list.Items) != 1 || text(list.Items[0].Version) != "0.3.0+abc" || text(list.Items[0].Type) != "web" {
		t.Errorf("the clients: %+v", list.Items)
	}
}
