// Package money is the server's twin of @household/domain's money (PRD modules/09-finance,
// "Money, once"): an integer in the currency's minor unit plus an ISO 4217 code, never a float
// and never numeric. The exponent comes from ISO 4217's own data, generated from the table the
// clients compute with, and is never assumed to be 2. A value is rounded half-up to the minor
// unit once, where it is materialised, never on intermediates; ties round away from zero, so a
// refund rounds as its charge did (D-94).
//
// Both implementations are held to packages/test-vectors/vectors/money.json (D-37): the same
// inputs give the same amounts, and the same refusals the same codes.
package money

//go:generate go run ./internal/gen

import (
	"fmt"
	"math/big"
	"regexp"
	"slices"
	"strings"
)

// Money is an amount in the contract's shape: `{ amount_minor, currency }`.
type Money struct {
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
}

// MaxMinor is the largest amount either side holds exactly: a JavaScript number is exact up to
// 2^53−1, so the server refuses what a client could not represent (about 90 trillion euros).
const MaxMinor = 1<<53 - 1

// Code says why an operation refused its input. The codes are the ones @household/domain
// throws, and the vectors hold the two to the same code for the same input.
type Code string

// The refusals.
const (
	UnknownCurrency      Code = "unknown_currency"
	NotMinorUnits        Code = "not_minor_units"
	OutOfRange           Code = "out_of_range"
	CurrencyMismatch     Code = "currency_mismatch"
	MalformedDecimal     Code = "malformed_decimal"
	InvalidRate          Code = "invalid_rate"
	NoParticipants       Code = "no_participants"
	DuplicateParticipant Code = "duplicate_participant"
	NotInOrder           Code = "not_in_order"
	InvalidWeight        Code = "invalid_weight"
)

// Error is a refusal, with its Code.
type Error struct {
	Code    Code
	Message string
}

func (e *Error) Error() string { return "money: " + e.Message }

func refuse(code Code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// Currencies returns the ISO 4217 codes this build knows, in alphabetical order.
func Currencies() []string {
	codes := make([]string, 0, len(exponents))
	for c := range exponents {
		codes = append(codes, c)
	}
	slices.Sort(codes)
	return codes
}

// Exponent returns the number of decimal places in currency's minor unit: 2 for EUR, 0 for JPY,
// 3 for BHD.
func Exponent(currency string) (int, error) {
	e, ok := exponents[currency]
	if !ok {
		return 0, refuse(UnknownCurrency, "%q is not an ISO 4217 code", currency)
	}
	return e, nil
}

// New returns amountMinor of currency, checked: a known currency, within MaxMinor.
func New(amountMinor int64, currency string) (Money, error) {
	if _, err := Exponent(currency); err != nil {
		return Money{}, err
	}
	if amountMinor > MaxMinor || amountMinor < -MaxMinor {
		return Money{}, refuse(OutOfRange, "%d minor units is out of range", amountMinor)
	}
	return Money{AmountMinor: amountMinor, Currency: currency}, nil
}

// Add returns a + b, in their one currency.
func Add(a, b Money) (Money, error) {
	x, y, err := same(a, b)
	if err != nil {
		return Money{}, err
	}
	return result(new(big.Int).Add(x, y), a.Currency)
}

// Subtract returns a − b, in their one currency.
func Subtract(a, b Money) (Money, error) {
	x, y, err := same(a, b)
	if err != nil {
		return Money{}, err
	}
	return result(new(big.Int).Sub(x, y), a.Currency)
}

// Multiply returns amount × factor, rounded half-up to the minor unit once. factor is a decimal
// string, as the contract carries every non-integer near money: "0.2" is a fifth, "-1" negates.
func Multiply(amount Money, factor string) (Money, error) {
	coefficient, denominator, err := decimal(factor)
	if err != nil {
		return Money{}, err
	}
	m, err := minor(amount)
	if err != nil {
		return Money{}, err
	}
	return result(RoundHalfUp(m.Mul(m, coefficient), denominator), amount.Currency)
}

// Convert returns amount in currency to, at rate units of to per unit of amount's currency,
// rounded half-up to to's minor unit once. rate is a positive decimal string, as a transaction
// stores it (D-55): ¥1 000 at "0.0062" EUR/JPY is €6.20.
func Convert(amount Money, rate, to string) (Money, error) {
	coefficient, denominator, err := decimal(rate)
	if err != nil {
		return Money{}, err
	}
	if coefficient.Sign() <= 0 {
		return Money{}, refuse(InvalidRate, "rate %q is not positive", rate)
	}
	from, err := Exponent(amount.Currency)
	if err != nil {
		return Money{}, err
	}
	into, err := Exponent(to)
	if err != nil {
		return Money{}, err
	}
	m, err := minor(amount)
	if err != nil {
		return Money{}, err
	}
	numerator := m.Mul(m, coefficient)
	numerator.Mul(numerator, pow10(into))
	return result(RoundHalfUp(numerator, denominator.Mul(denominator, pow10(from))), to)
}

// Share is one participant's part of a split.
type Share struct {
	Participant string `json:"participant"`
	Amount      Money  `json:"amount"`
}

// Split divides total between participants in proportion to weights (one each when weights is
// nil: an equal split), exactly: the parts sum to the total. Each part is its proportion
// rounded down; the minor units left over go one each to the participants in the household's
// member order, order, first to last (D-57). So €10.00 three ways is 3.34 / 3.33 / 3.33, and
// the 3.34 is the same member's however the participants are listed. A negative total splits
// as its positive counterpart, negated, so a refund returns to each member what they paid
// (D-94). The shares come back in the household's order.
func Split(total Money, participants, order []string, weights []int64) ([]Share, error) {
	amount, err := minor(total)
	if err != nil {
		return nil, err
	}
	if len(participants) == 0 {
		return nil, refuse(NoParticipants, "a split needs at least one participant")
	}
	if weights != nil && len(weights) != len(participants) {
		return nil, refuse(InvalidWeight, "a split needs one weight per participant")
	}
	rank := make(map[string]int, len(order))
	for i, id := range order {
		if _, seen := rank[id]; !seen {
			rank[id] = i
		}
	}
	type part struct {
		participant string
		position    int
		weight      *big.Int
	}
	parts := make([]part, 0, len(participants))
	for i, p := range participants {
		position, ok := rank[p]
		if !ok {
			return nil, refuse(NotInOrder, "%q is not in the household's order", p)
		}
		weight := int64(1)
		if weights != nil {
			weight = weights[i]
		}
		if weight <= 0 || weight > MaxMinor {
			return nil, refuse(InvalidWeight, "weight %d is not a positive whole number", weight)
		}
		parts = append(parts, part{participant: p, position: position, weight: big.NewInt(weight)})
	}
	slices.SortStableFunc(parts, func(a, b part) int { return a.position - b.position })
	for i := 1; i < len(parts); i++ {
		if parts[i].participant == parts[i-1].participant {
			return nil, refuse(DuplicateParticipant, "%q is listed twice", parts[i].participant)
		}
	}

	magnitude := new(big.Int).Abs(amount)
	sum := new(big.Int)
	for _, p := range parts {
		sum.Add(sum, p.weight)
	}
	floors := make([]*big.Int, len(parts))
	left := new(big.Int).Set(magnitude)
	for i, p := range parts {
		floors[i] = new(big.Int).Quo(new(big.Int).Mul(magnitude, p.weight), sum)
		left.Sub(left, floors[i])
	}
	one := big.NewInt(1)
	for i := 0; left.Sign() > 0; i, left = (i+1)%len(floors), left.Sub(left, one) {
		floors[i].Add(floors[i], one)
	}
	shares := make([]Share, len(parts))
	for i, p := range parts {
		share := floors[i].Int64()
		if amount.Sign() < 0 {
			share = -share
		}
		shares[i] = Share{Participant: p.participant, Amount: Money{AmountMinor: share, Currency: total.Currency}}
	}
	return shares, nil
}

// RoundHalfUp returns numerator / denominator rounded half-up to an integer, ties away from
// zero: 2.5 → 3 and −2.5 → −3. The denominator is positive. numerator is not preserved.
func RoundHalfUp(numerator, denominator *big.Int) *big.Int {
	twice := new(big.Int).Lsh(denominator, 1)
	negative := numerator.Sign() < 0
	n := numerator.Abs(numerator)
	n.Lsh(n, 1).Add(n, denominator).Quo(n, twice)
	if negative {
		n.Neg(n)
	}
	return n
}

var decimalPattern = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`)

// decimal returns text as coefficient / denominator, exactly: "-1.25" is −125 / 100.
func decimal(text string) (coefficient, denominator *big.Int, err error) {
	if !decimalPattern.MatchString(text) {
		return nil, nil, refuse(MalformedDecimal, "%q is not a decimal", text)
	}
	places := 0
	if point := strings.IndexByte(text, '.'); point >= 0 {
		places = len(text) - point - 1
	}
	coefficient, ok := new(big.Int).SetString(strings.Replace(text, ".", "", 1), 10)
	if !ok {
		return nil, nil, refuse(MalformedDecimal, "%q is not a decimal", text)
	}
	return coefficient, pow10(places), nil
}

func pow10(n int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
}

// minor returns m's amount, checked as New checks it.
func minor(m Money) (*big.Int, error) {
	if _, err := New(m.AmountMinor, m.Currency); err != nil {
		return nil, err
	}
	return big.NewInt(m.AmountMinor), nil
}

func same(a, b Money) (x, y *big.Int, err error) {
	if _, err := Exponent(a.Currency); err != nil {
		return nil, nil, err
	}
	if _, err := Exponent(b.Currency); err != nil {
		return nil, nil, err
	}
	if a.Currency != b.Currency {
		return nil, nil, refuse(CurrencyMismatch, "%s and %s do not add", a.Currency, b.Currency)
	}
	if x, err = minor(a); err != nil {
		return nil, nil, err
	}
	if y, err = minor(b); err != nil {
		return nil, nil, err
	}
	return x, y, nil
}

func result(value *big.Int, currency string) (Money, error) {
	if !value.IsInt64() || value.Int64() > MaxMinor || value.Int64() < -MaxMinor {
		return Money{}, refuse(OutOfRange, "%s minor units is out of range", value)
	}
	return Money{AmountMinor: value.Int64(), Currency: currency}, nil
}
