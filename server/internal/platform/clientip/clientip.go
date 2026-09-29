// Package clientip finds the address a request came from, for the limits that count a client's
// network (PRD 02 §9). Behind a proxy the connection's peer is the proxy, and every client would
// share its one budget; so a peer the server is configured to trust as a proxy is looked past, to
// the address it says the request came from in X-Forwarded-For. An address a client claims for
// itself there is never believed: only the entries its trusted proxies appended count.
package clientip

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Resolver finds a request's client address.
type Resolver struct {
	trusted []netip.Prefix
}

// New returns a resolver that looks past the proxies in trusted.
func New(trusted []netip.Prefix) *Resolver { return &Resolver{trusted: trusted} }

// ParsePrefixes reads a comma-separated list of addresses and CIDR prefixes, "10.0.0.0/8, ::1".
// An IPv4-mapped IPv6 address or prefix, ::ffff:10.0.0.0/104, is read as the IPv4 one it maps,
// since Addr compares addresses unmapped.
func ParsePrefixes(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if p, err := netip.ParsePrefix(item); err == nil {
			if a := p.Addr(); a.Is4In6() && p.Bits() >= 96 {
				p = netip.PrefixFrom(a.Unmap(), p.Bits()-96)
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(item)
		if err != nil {
			return nil, fmt.Errorf("clientip: %q is not an address or a prefix", item)
		}
		out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
	}
	return out, nil
}

func (r *Resolver) trusts(a netip.Addr) bool {
	for _, p := range r.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// Addr returns the address req came from: its peer, or, while the peer is a trusted proxy, the
// last address in X-Forwarded-For that is not one, read from the right, the end the proxies
// appended to. An entry may carry a port, as some proxies append one, which is dropped; an entry
// that is not an address stops the reading at the proxy before it. The zero Addr is a peer that is
// not an IP address at all, a test's.
func (r *Resolver) Addr(req *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		host = req.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	addr = addr.Unmap()
	if !r.trusts(addr) {
		return addr
	}
	var hops []string
	for _, header := range req.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(header, ",")...)
	}
	for i := len(hops) - 1; i >= 0; i-- {
		hop, ok := hopAddr(strings.TrimSpace(hops[i]))
		if !ok {
			break
		}
		addr = hop.Unmap()
		if !r.trusts(addr) {
			break
		}
	}
	return addr
}

// hopAddr is an X-Forwarded-For entry's address: an address, or one with a port, 203.0.113.7:51234
// or [2001:db8::1]:51234.
func hopAddr(entry string) (netip.Addr, bool) {
	if a, err := netip.ParseAddr(entry); err == nil {
		return a, true
	}
	if ap, err := netip.ParseAddrPort(entry); err == nil {
		return ap.Addr(), true
	}
	return netip.Addr{}, false
}

// Network is the part of addr a limit counts: an IPv4 address whole, and an IPv6 address's /64,
// which one subscriber is commonly given entire, so that stepping through it buys no attempts.
// A zero addr counts as one network of its own.
func Network(addr netip.Addr) string {
	if !addr.IsValid() {
		return "unknown"
	}
	if addr.Is4() {
		return addr.String()
	}
	p, _ := addr.Prefix(64)
	return p.String()
}
