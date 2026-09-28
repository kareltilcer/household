package mail_test

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kareltilcer/household/server/internal/platform/i18n"
	hhmail "github.com/kareltilcer/household/server/internal/platform/mail"
)

// received is a message the fake server took.
type received struct {
	from, to string
	data     string
	tls      bool
	auth     string
}

// server is a fake SMTP server on the loopback interface, enough of RFC 5321 to take a message:
// EHLO, optionally STARTTLS and AUTH PLAIN, MAIL, RCPT, DATA and QUIT. stall makes it greet and
// then say nothing more.
type server struct {
	t        *testing.T
	ln       net.Listener
	tls      *tls.Config
	stall    bool
	mu       sync.Mutex
	messages []received
}

func newServer(t *testing.T, tlsConfig *tls.Config, stall bool) *server {
	t.Helper()
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &server{t: t, ln: ln, tls: tlsConfig, stall: stall}
	go s.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return s
}

func (s *server) url() string { return "smtp://" + s.ln.Addr().String() }

func (s *server) serve() {
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.session(conn)
	}
}

func (s *server) session(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	tp := textproto.NewConn(conn)
	reply := func(line string) { _ = tp.PrintfLine("%s", line) }
	reply("220 fake ESMTP")
	if s.stall {
		_, _ = io.Copy(io.Discard, conn)
		return
	}
	var msg received
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(line, " ")
		switch strings.ToUpper(verb) {
		case "EHLO":
			lines := []string{"250-fake"}
			if s.tls != nil && !msg.tls {
				lines = append(lines, "250-STARTTLS")
			}
			lines = append(lines, "250 AUTH PLAIN")
			for _, l := range lines {
				reply(l)
			}
		case "STARTTLS":
			reply("220 go ahead")
			tlsConn := tls.Server(conn, s.tls)
			if err := tlsConn.HandshakeContext(context.Background()); err != nil {
				return
			}
			conn = tlsConn
			tp = textproto.NewConn(conn)
			msg.tls = true
		case "AUTH":
			msg.auth = arg
			reply("235 ok")
		case "MAIL":
			msg.from = arg
			reply("250 ok")
		case "RCPT":
			// A mailbox named rejected does not exist, and the reply says which, as Postfix's does.
			if strings.Contains(arg, "rejected@") {
				reply("550 5.1.1 " + strings.TrimPrefix(arg, "TO:") + ": Recipient address rejected: User unknown")
				continue
			}
			msg.to = arg
			reply("250 ok")
		case "DATA":
			reply("354 go ahead")
			data, err := tp.ReadDotBytes()
			if err != nil {
				return
			}
			msg.data = string(data)
			s.mu.Lock()
			s.messages = append(s.messages, msg)
			s.mu.Unlock()
			reply("250 queued")
		case "QUIT":
			reply("221 bye")
			return
		default:
			reply("502 no")
		}
	}
}

func (s *server) received() []received {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]received(nil), s.messages...)
}

// parse reads a received message's headers and decoded body.
func parse(t *testing.T, data string) (*mail.Message, string, string) {
	t.Helper()
	m, err := mail.ReadMessage(bufio.NewReader(strings.NewReader(data)))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(m.Header.Get("Subject"))
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(quotedprintable.NewReader(m.Body))
	if err != nil {
		t.Fatal(err)
	}
	return m, subject, string(body)
}

func TestAMessageIsDeliveredAsPlainTextInItsLanguage(t *testing.T) {
	srv := newServer(t, nil, false)
	sender, err := hhmail.NewSMTP(srv.url(), "Household <no-reply@household.example>")
	if err != nil {
		t.Fatal(err)
	}
	catalogs, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	link := "https://app.household.example/verify-email#token=abc"
	m, err := hhmail.Render(catalogs, i18n.Czech, "email.verify_email", i18n.Args{"link": link}, "jana@tilcerovi.cz")
	if err != nil {
		t.Fatal(err)
	}
	if err := sender.Send(t.Context(), m); err != nil {
		t.Fatal(err)
	}
	got := srv.received()
	if len(got) != 1 || got[0].from != "FROM:<no-reply@household.example>" || got[0].to != "TO:<jana@tilcerovi.cz>" {
		t.Fatalf("%+v", got)
	}
	msg, subject, body := parse(t, got[0].data)
	if subject != "Potvrďte svou e-mailovou adresu v aplikaci Household" {
		t.Errorf("subject %q", subject)
	}
	if !strings.Contains(body, link) || !strings.Contains(body, "Odkaz platí 24 hodin.") || strings.Contains(body, "\r\n\r\n\r\n") {
		t.Errorf("body %q", body)
	}
	for name, want := range map[string]string{
		"From": `"Household" <no-reply@household.example>`, "To": "<jana@tilcerovi.cz>", "MIME-Version": "1.0",
		"Content-Type": "text/plain; charset=utf-8", "Content-Transfer-Encoding": "quoted-printable",
		"Auto-Submitted": "auto-generated",
	} {
		if got := msg.Header.Get(name); got != want {
			t.Errorf("%s: %q, want %q", name, got, want)
		}
	}
	if !strings.HasSuffix(msg.Header.Get("Message-ID"), "@household.example>") || msg.Header.Get("Date") == "" {
		t.Errorf("Message-ID %q, Date %q", msg.Header.Get("Message-ID"), msg.Header.Get("Date"))
	}
}

// A server that offers STARTTLS is spoken to over TLS, and the credentials go over it.
func TestSTARTTLSIsUsedWhenOffered(t *testing.T) {
	ts := httptest.NewUnstartedServer(nil)
	ts.StartTLS()
	defer ts.Close()
	srv := newServer(t, &tls.Config{Certificates: ts.TLS.Certificates, MinVersion: tls.VersionTLS12}, false)
	sender, err := hhmail.NewSMTP("smtp://household:secret@"+srv.ln.Addr().String(), "no-reply@household.example")
	if err != nil {
		t.Fatal(err)
	}
	transport, ok := ts.Client().Transport.(*http.Transport)
	if !ok {
		t.Fatal("httptest's client has no *http.Transport")
	}
	roots := transport.TLSClientConfig.RootCAs
	sender = sender.WithTLSConfig(&tls.Config{RootCAs: roots, ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12})
	if err := sender.Send(t.Context(), hhmail.Message{To: "petr@example.com", Subject: "s", Body: "b"}); err != nil {
		t.Fatal(err)
	}
	got := srv.received()
	if len(got) != 1 || !got[0].tls || !strings.HasPrefix(got[0].auth, "PLAIN ") {
		t.Fatalf("%+v", got)
	}
}

func TestALineBreakInAHeaderIsRefused(t *testing.T) {
	srv := newServer(t, nil, false)
	sender, err := hhmail.NewSMTP(srv.url(), "no-reply@household.example")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range []hhmail.Message{
		{To: "jana@example.com\r\nBcc: everyone@example.com", Subject: "s", Body: "b"},
		{To: "jana@example.com", Subject: "s\r\nBcc: everyone@example.com", Body: "b"},
		{To: "not an address", Subject: "s", Body: "b"},
	} {
		if err := sender.Send(t.Context(), m); err == nil {
			t.Errorf("%+v was sent", m)
		}
	}
	if len(srv.received()) != 0 {
		t.Fatal("a refused message reached the server")
	}
}

// A server that stops answering is given up on when the context ends.
func TestAStalledServerIsGivenUpOn(t *testing.T) {
	srv := newServer(t, nil, true)
	sender, err := hhmail.NewSMTP(srv.url(), "no-reply@household.example")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	started := time.Now()
	if err := sender.Send(ctx, hhmail.Message{To: "jana@example.com", Subject: "s", Body: "b"}); err == nil {
		t.Fatal("sent to a server that never answered")
	}
	if time.Since(started) > 5*time.Second {
		t.Fatalf("gave up after %v", time.Since(started))
	}
}

// A reply that refuses the message is reported by its code alone: its text quotes the recipient's
// address, which the error is logged with.
func TestARefusalIsReportedByItsCode(t *testing.T) {
	srv := newServer(t, nil, false)
	sender, err := hhmail.NewSMTP(srv.url(), "no-reply@household.example")
	if err != nil {
		t.Fatal(err)
	}
	err = sender.Send(t.Context(), hhmail.Message{To: "rejected@example.com", Subject: "s", Body: "b"})
	if err == nil || strings.Contains(err.Error(), "rejected@") || !strings.Contains(err.Error(), "RCPT TO: the server replied 550") {
		t.Fatalf("%v", err)
	}
}

func TestTheSMTPURLIsChecked(t *testing.T) {
	for _, bad := range []string{"http://mail:25", "smtp://mail", "smtp://:25", "%zz"} {
		if _, err := hhmail.NewSMTP(bad, "no-reply@household.example"); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if _, err := hhmail.NewSMTP("smtps://mail:465", "not an address"); err == nil {
		t.Error("a From that is no address accepted")
	}
	if _, err := hhmail.NewSMTP("smtps://user:pw@mail:465", "Household <no-reply@household.example>"); err != nil {
		t.Error(err)
	}
}

func TestAMissingTemplateIsAnError(t *testing.T) {
	catalogs, err := i18n.Default()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hhmail.Render(catalogs, i18n.English, "email.nothing", nil, "a@example.com"); !errors.Is(err, i18n.ErrUnknownKey) {
		t.Fatalf("%v", err)
	}
}
