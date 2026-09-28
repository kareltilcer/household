// Package mail sends the server's email (PRD 03 §4, §9): a message rendered from translation keys
// in its recipient's language, never a stored sentence, and delivered over SMTP. Item 8's account
// emails are the first; item 17 makes this a notification transport.
//
// A message is plain text, UTF-8 and quoted-printable. Its headers are built here from values
// checked here: an address or a subject that carries a line break is refused, since it would
// start a header of the sender's choosing.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
)

// maxAddress is the longest address SMTP carries, in octets (RFC 5321 §4.5.3.1.3, less the angle
// brackets): an address in UTF-8 (RFC 6531) is as long as its bytes, not its characters.
const maxAddress = 254

// ValidAddress reports whether s is an email address and nothing else: an addr-spec, as RFC 5322
// and RFC 6532 have it, with no display name, no comment and no surrounding space, at a domain
// name, not an address in brackets (jana@[192.0.2.1]), which would have the relay deliver to
// whichever host the caller named, and no longer than SMTP carries. The contract's
// `format: email` is this check, at the edge.
func ValidAddress(s string) bool {
	if len(s) > maxAddress || strings.ContainsAny(s, "\r\n") {
		return false
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Name != "" || a.Address != s {
		return false
	}
	return !strings.HasPrefix(s[strings.LastIndexByte(s, '@')+1:], "[")
}

// Message is one email to one recipient.
type Message struct {
	To      string
	Subject string
	Body    string
}

// Sender delivers a message.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// Template is an email the catalogs hold: its subject is the key <Template>.subject and its body
// <Template>.body.
type Template string

// Render renders t in locale with args, from catalogs, into a message to to.
func Render(catalogs *i18n.Catalogs, locale i18n.Locale, t Template, args i18n.Args, to string) (Message, error) {
	subject, err := catalogs.Render(locale, string(t)+".subject", args)
	if err != nil {
		return Message{}, fmt.Errorf("mail: %w", err)
	}
	body, err := catalogs.Render(locale, string(t)+".body", args)
	if err != nil {
		return Message{}, fmt.Errorf("mail: %w", err)
	}
	return Message{To: to, Subject: subject, Body: body}, nil
}

// SMTP delivers over SMTP to one server.
type SMTP struct {
	host, port string
	// implicitTLS is smtps: TLS from the first byte. Otherwise STARTTLS is required, except on a
	// loopback host, where it is used when offered: a development catcher speaks plain SMTP.
	implicitTLS bool
	auth        smtp.Auth
	from        *mail.Address
	timeout     time.Duration
	// tlsConfig is the TLS the connection uses; nil for the system's roots and the host's name.
	tlsConfig *tls.Config
}

// NewSMTP returns a sender for rawURL, smtp://[user:password@]host:port or smtps://…, sending
// from from, an address with an optional name: "Household <no-reply@household.example>".
func NewSMTP(rawURL, from string) (*SMTP, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, errors.New("mail: the SMTP URL does not parse")
	}
	s := &SMTP{timeout: 30 * time.Second}
	switch u.Scheme {
	case "smtp":
	case "smtps":
		s.implicitTLS = true
	default:
		return nil, fmt.Errorf("mail: the SMTP URL's scheme is %q; want smtp or smtps", u.Scheme)
	}
	s.host, s.port = u.Hostname(), u.Port()
	if s.host == "" || s.port == "" {
		return nil, errors.New("mail: the SMTP URL needs a host and a port")
	}
	if u.User != nil {
		password, _ := u.User.Password()
		// PlainAuth itself refuses to send the password over a connection that is not TLS,
		// unless the server is on this machine.
		s.auth = smtp.PlainAuth("", u.User.Username(), password, s.host)
	}
	if s.from, err = mail.ParseAddress(from); err != nil {
		return nil, errors.New("mail: the From address does not parse")
	}
	return s, nil
}

// WithTLSConfig returns s using config for TLS: a test's, trusting its own server.
func (s *SMTP) WithTLSConfig(config *tls.Config) *SMTP {
	c := *s
	c.tlsConfig = config
	return &c
}

func (s *SMTP) tls() *tls.Config {
	if s.tlsConfig != nil {
		return s.tlsConfig
	}
	return &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}
}

func loopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Send delivers m, within s's timeout and ctx's deadline, whichever ends first.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	to, err := mail.ParseAddress(m.To)
	if err != nil || strings.ContainsAny(m.To, "\r\n") {
		return errors.New("mail: the recipient is not an address")
	}
	data, err := s.format(m, to)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	addr := net.JoinHostPort(s.host, s.port)
	dialer := &net.Dialer{}
	var conn net.Conn
	if s.implicitTLS {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: s.tls()}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("mail: connect: %w", err)
	}
	defer func() { _ = conn.Close() }()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	// Closing the connection when ctx ends unblocks whichever exchange is waiting on it.
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	c, err := smtp.NewClient(conn, s.host)
	if err != nil {
		return failed("greeting", err)
	}
	defer func() { _ = c.Close() }()
	// A name the relay can resolve, not net/smtp's default of localhost, which a relay that
	// holds its clients to a fully qualified name refuses: the sender's domain.
	if err := c.Hello(s.domain()); err != nil {
		return failed("EHLO", err)
	}
	if !s.implicitTLS {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(s.tls()); err != nil {
				return failed("STARTTLS", err)
			}
		} else if !loopback(s.host) {
			return errors.New("mail: the server does not offer STARTTLS, and mail leaves this machine only over TLS")
		}
	}
	if s.auth != nil {
		if err := c.Auth(s.auth); err != nil {
			return failed("authenticate", err)
		}
	}
	if err := c.Mail(s.from.Address); err != nil {
		return failed("MAIL FROM", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return failed("RCPT TO", err)
	}
	w, err := c.Data()
	if err != nil {
		return failed("DATA", err)
	}
	if _, err := w.Write(data); err != nil {
		return failed("DATA", err)
	}
	if err := w.Close(); err != nil {
		return failed("DATA", err)
	}
	if err := c.Quit(); err != nil {
		return failed("QUIT", err)
	}
	return nil
}

// failed is the error of an SMTP exchange that failed at step. A reply from the server is reduced
// to its code: its text often quotes the recipient's address, which is logged nowhere.
func failed(step string, err error) error {
	var reply *textproto.Error
	if errors.As(err, &reply) {
		return fmt.Errorf("mail: %s: the server replied %d", step, reply.Code)
	}
	return fmt.Errorf("mail: %s: %w", step, err)
}

// domain is the sender's domain: the name s greets a relay with, and its messages' ids end in.
func (s *SMTP) domain() string {
	return s.from.Address[strings.LastIndexByte(s.from.Address, '@')+1:]
}

// format is m as the bytes of an RFC 5322 message.
func (s *SMTP) format(m Message, to *mail.Address) ([]byte, error) {
	if strings.ContainsAny(m.Subject, "\r\n") {
		return nil, errors.New("mail: a subject with a line break")
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	var b bytes.Buffer
	for _, h := range [][2]string{
		{"From", s.from.String()},
		{"To", to.String()},
		{"Subject", mime.QEncoding.Encode("utf-8", m.Subject)},
		{"Date", time.Now().UTC().Format(time.RFC1123Z)},
		{"Message-ID", "<" + hex.EncodeToString(id) + "@" + s.domain() + ">"},
		{"MIME-Version", "1.0"},
		{"Content-Type", "text/plain; charset=utf-8"},
		{"Content-Transfer-Encoding", "quoted-printable"},
		// An automatic message (RFC 3834): an out-of-office reply is not sent back to it.
		{"Auto-Submitted", "auto-generated"},
	} {
		b.WriteString(h[0] + ": " + h[1] + "\r\n")
	}
	b.WriteString("\r\n")
	qp := quotedprintable.NewWriter(&b)
	if _, err := qp.Write([]byte(strings.ReplaceAll(strings.ReplaceAll(m.Body, "\r\n", "\n"), "\n", "\r\n"))); err != nil {
		return nil, err
	}
	if err := qp.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}
