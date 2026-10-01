package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// DefaultExpoURL is Expo's push service, whose send and getReceipts sit under it.
const DefaultExpoURL = "https://exp.host/--/api/v2/push"

// Receipts are how long a ticket waits before its receipt is asked for, and how long Expo keeps one.
const (
	receiptAfter = 15 * time.Minute
	receiptKept  = 24 * time.Hour
	// receiptBatch is the most tickets one request to getReceipts may name.
	receiptBatch = 1000
)

// deviceNotRegistered is the error Expo answers for a token Apple or Google no longer knows: the
// device uninstalled the app, or its token changed. It is a 410's equivalent.
const deviceNotRegistered = "DeviceNotRegistered"

// expoServiceErrors are the errors Expo answers that say nothing of the device's token: the project's
// credentials with Apple or Google, a message too big or not well made, too many sent to the device at
// once, or a failure of Expo's own or of Apple's or Google's service. Each would fail a push to any
// token, and counted against the tokens they reached, they would mark every device stale while the
// project's settings were wrong or a service was down.
var expoServiceErrors = map[string]bool{
	"InvalidCredentials": true, "MismatchSenderId": true, "MessageTooBig": true, "MessageRateExceeded": true,
	"DeveloperError": true, "ExpoError": true, "ProviderError": true,
}

// expoStatus is what an error Expo reports of a push, in its ticket or its receipt, says of the device's
// token: DeviceNotRegistered that it is gone, one of expoServiceErrors nothing, nor does one that names
// no error at all, which lays the failure on no device, and any other that the push failed there.
func expoStatus(code string) Status {
	switch {
	case code == deviceNotRegistered:
		return Gone
	case code == "" || expoServiceErrors[code]:
		return Unavailable
	default:
		return Failed
	}
}

// Expo delivers to the mobile app through Expo's push service, which hands each push to Apple's or
// Google's (FR-NT1). It takes a push with a ticket, and says only in the ticket's receipt, a few
// minutes later, whether Apple or Google took it from there.
type Expo struct {
	send, receipts string
	// token is the Expo access token push requests carry when the project requires one, "" when not.
	token  string
	client *http.Client
}

// NewExpo returns the Expo transport for the push service at base, its requests carrying the access
// token token when it is not "", over client: nil for one of its own, which waits 15 seconds.
func NewExpo(base, token string, client *http.Client) (*Expo, error) {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, errors.New("notify: the Expo push service's URL does not parse")
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	base = strings.TrimSuffix(u.String(), "/")
	return &Expo{send: base + "/send", receipts: base + "/getReceipts", token: token, client: client}, nil
}

// expoMessage is a push as Expo takes it.
type expoMessage struct {
	To       string            `json:"to"`
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Data     map[string]string `json:"data"`
	Sound    string            `json:"sound,omitempty"`
	Priority string            `json:"priority"`
	TTL      int               `json:"ttl"`
}

// expoTicket is Expo's answer to a push, and a receipt the same shape without its id.
type expoTicket struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// Push sends m to t's device. Expo not answering, or answering anything but a ticket, says nothing of
// the device (Unavailable). An ok ticket is a push Expo took, holding it for the device, even one
// without the id its receipt would be asked for by: tried again, it would arrive twice.
func (e *Expo) Push(ctx context.Context, t Target, m Push) Outcome {
	msg := expoMessage{
		To: t.Token, Title: cut(m.Title, maxTitle), Body: cut(m.Body, maxBody), Priority: "default", TTL: int(pushTTL.Seconds()),
		Data: map[string]string{"url": m.Link, "household_id": m.Household.String(), "notification_id": m.Notification.String()},
	}
	if m.Tag != "" {
		msg.Data["tag"] = m.Tag
	}
	if m.Urgent {
		msg.Priority, msg.Sound = "high", "default"
	}
	var answer struct {
		Data []expoTicket `json:"data"`
	}
	if err := e.post(ctx, e.send, []expoMessage{msg}, &answer); err != nil || len(answer.Data) != 1 {
		return Outcome{Status: Unavailable}
	}
	switch ticket := answer.Data[0]; ticket.Status {
	case "ok":
		return Outcome{Status: Accepted, Ticket: ticket.ID}
	case "error":
		return Outcome{Status: expoStatus(ticket.Details.Error)}
	default:
		return Outcome{Status: Unavailable}
	}
}

// Receipts returns the receipts of tickets Expo has, each Accepted, or what its error says of its
// device's token (expoStatus): a ticket it has none for yet is left out.
func (e *Expo) Receipts(ctx context.Context, tickets []string) (map[string]Status, error) {
	var answer struct {
		Data map[string]expoTicket `json:"data"`
	}
	if err := e.post(ctx, e.receipts, map[string][]string{"ids": tickets}, &answer); err != nil {
		return nil, err
	}
	out := make(map[string]Status, len(answer.Data))
	for id, r := range answer.Data {
		if r.Status == "ok" {
			out[id] = Accepted
		} else {
			out[id] = expoStatus(r.Details.Error)
		}
	}
	return out, nil
}

// post posts body to endpoint as JSON and reads a 200's answer into into.
func (e *Expo) post(ctx context.Context, endpoint string, body, into any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if e.token != "" {
		req.Header.Set("Authorization", "Bearer "+e.token)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("notify: Expo: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return fmt.Errorf("notify: Expo answered %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(into)
}

// ReceiptReader reads Expo's receipts.
type ReceiptReader interface {
	Receipts(ctx context.Context, tickets []string) (map[string]Status, error)
}

// CheckReceipts asks Expo for the receipts of the tickets old enough to have one, and records what each
// says of its device's token (FR-NT6): a push Apple or Google took ends the run of failures, which a
// ticket, saying only that Expo took it, does not; DeviceNotRegistered clears the token, as a 410
// deletes a browser's subscription; an error of the push's there counts towards the run of failures
// that marks it stale, and one of the project's or of a service's own (Unavailable) towards nothing. A
// ticket whose receipt came, or that is older than Expo keeps receipts, is done with, the second
// whether or not Expo answers. The scheduler runs it every fifteen minutes.
func (s *Service) CheckReceipts(ctx context.Context) error {
	type pending struct {
		ticket       string
		user, device uuid.UUID
		token        string
		sentAt       time.Time
	}
	after, afterTicket := time.Time{}, ""
	for {
		var batch []pending
		err := tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `
				SELECT ticket, user_id, device_id, token, sent_at FROM push_receipts
				WHERE sent_at <= now() - make_interval(secs => $1) AND (sent_at, ticket) > ($2, $3)
				ORDER BY sent_at, ticket LIMIT $4`, receiptAfter.Seconds(), after, afterTicket, receiptBatch)
			if err != nil {
				return err
			}
			batch, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (pending, error) {
				var p pending
				err := row.Scan(&p.ticket, &p.user, &p.device, &p.token, &p.sentAt)
				return p, err
			})
			return err
		})
		if err != nil || len(batch) == 0 {
			return err
		}
		tickets := make([]string, len(batch))
		for i, p := range batch {
			tickets[i] = p.ticket
		}
		receipts, err := s.cfg.Receipts.Receipts(ctx, tickets)
		if err != nil {
			// Expo did not answer, or refused the batch: the tickets older than it keeps receipts are
			// done with all the same, so that an outage, or an access token getReceipts refuses, keeps
			// none past its day, nor asks for the same oldest batch on every run for ever.
			return errors.Join(err, s.forgetReceipts(ctx))
		}
		gone, failed := 0, 0
		err = tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
			var done []string
			for _, p := range batch {
				status, came := receipts[p.ticket]
				if !came && time.Since(p.sentAt) < receiptKept {
					continue
				}
				var err error
				switch {
				case came && status == Accepted:
					err = deliveredToken(ctx, tx, p.user, p.device, p.token)
				case came && status == Gone:
					gone++
					err = forgetToken(ctx, tx, p.user, p.device, p.token)
				case came && status == Failed:
					failed++
					err = failToken(ctx, tx, p.user, p.device, p.token)
				}
				if err != nil {
					return err
				}
				done = append(done, p.ticket)
			}
			_, err := tx.Exec(ctx, "DELETE FROM push_receipts WHERE ticket = ANY($1)", done)
			return err
		})
		if err != nil {
			return err
		}
		if gone > 0 || failed > 0 {
			s.cfg.Log.LogAttrs(ctx, slog.LevelInfo, "notify: Expo receipts read", slog.Int("gone", gone), slog.Int("failed", failed))
		}
		if len(batch) < receiptBatch {
			return nil
		}
		last := batch[len(batch)-1]
		after, afterTicket = last.sentAt, last.ticket
	}
}

// forgetReceipts deletes the tickets older than Expo keeps receipts, unread.
func (s *Service) forgetReceipts(ctx context.Context) error {
	return tenant.AccountTx(ctx, s.cfg.Pool, uuid.Nil, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "DELETE FROM push_receipts WHERE sent_at < now() - make_interval(secs => $1)", receiptKept.Seconds())
		return err
	})
}
