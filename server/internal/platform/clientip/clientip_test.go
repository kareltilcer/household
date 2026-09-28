package clientip_test

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/clientip"
)

func request(t *testing.T, peer string, forwarded ...string) *http.Request {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", nil)
	req.RemoteAddr = peer
	for _, f := range forwarded {
		req.Header.Add("X-Forwarded-For", f)
	}
	return req
}

func TestTheClientIsThePeerUnlessThePeerIsATrustedProxy(t *testing.T) {
	trusted, err := clientip.ParsePrefixes("10.0.0.0/8, 192.168.1.1 ,fd00::/8")
	if err != nil {
		t.Fatal(err)
	}
	r := clientip.New(trusted)
	for name, c := range map[string]struct {
		req  *http.Request
		want string
	}{
		"no proxy":                     {request(t, "203.0.113.7:5000", "198.51.100.1"), "203.0.113.7"},
		"a trusted proxy":              {request(t, "10.1.2.3:443", "198.51.100.1"), "198.51.100.1"},
		"a client's own claim ignored": {request(t, "10.1.2.3:443", "1.1.1.1, 198.51.100.1"), "198.51.100.1"},
		"two trusted proxies":          {request(t, "10.1.2.3:443", "198.51.100.1, 192.168.1.1"), "198.51.100.1"},
		"headers read in order":        {request(t, "10.1.2.3:443", "1.1.1.1", "198.51.100.1, 10.9.9.9"), "198.51.100.1"},
		"a garbage entry":              {request(t, "10.1.2.3:443", "198.51.100.1, nonsense"), "10.1.2.3"},
		"nothing forwarded":            {request(t, "10.1.2.3:443"), "10.1.2.3"},
		"only proxies":                 {request(t, "10.1.2.3:443", "10.4.4.4"), "10.4.4.4"},
		"IPv6":                         {request(t, "[fd00::1]:443", "2001:db8::5"), "2001:db8::5"},
		"a mapped IPv4 peer":           {request(t, "[::ffff:203.0.113.7]:5000"), "203.0.113.7"},
	} {
		if got := r.Addr(c.req); got.String() != c.want {
			t.Errorf("%s: %s, want %s", name, got, c.want)
		}
	}
	if got := r.Addr(request(t, "pipe")); got.IsValid() {
		t.Errorf("a peer that is no address: %s", got)
	}
}

func TestAPrefixListIsChecked(t *testing.T) {
	if _, err := clientip.ParsePrefixes("10.0.0.0/8, not-an-address"); err == nil {
		t.Fatal("garbage accepted")
	}
	if p, err := clientip.ParsePrefixes(" "); err != nil || len(p) != 0 {
		t.Fatalf("an empty list: %v %v", p, err)
	}
}

func TestANetworkIsAnIPv4AddressOrAnIPv6Slash64(t *testing.T) {
	for addr, want := range map[string]string{
		"203.0.113.7":          "203.0.113.7",
		"2001:db8:1:2:3:4:5:6": "2001:db8:1:2::/64",
		"2001:db8:1:2:ffff::1": "2001:db8:1:2::/64",
	} {
		if got := clientip.Network(netip.MustParseAddr(addr)); got != want {
			t.Errorf("%s: %s, want %s", addr, got, want)
		}
	}
	if clientip.Network(netip.Addr{}) != "unknown" {
		t.Error("the zero address")
	}
}
