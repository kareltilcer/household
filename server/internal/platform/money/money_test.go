package money_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"strconv"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/money"
	"github.com/kareltilcer/household/server/internal/platform/money/internal/codegen"
	"github.com/kareltilcer/household/server/internal/platform/repo"
	"github.com/kareltilcer/household/server/internal/platform/vectors"
)

// The shared vectors, run against the server's twin. JSON gives an amount or a weight that is
// not a whole number no way into an int64, so the inputs carry them as numbers and the
// subjects refuse a fraction as @household/domain does.
func TestVectors(t *testing.T) {
	type amount struct {
		AmountMinor json.Number `json:"amount_minor"`
		Currency    string      `json:"currency"`
	}
	whole := func(a amount) (money.Money, error) {
		n, err := strconv.ParseInt(a.AmountMinor.String(), 10, 64)
		if err != nil {
			return money.Money{}, &money.Error{Code: money.NotMinorUnits, Message: err.Error()}
		}
		return money.Money{AmountMinor: n, Currency: a.Currency}, nil
	}
	vectors.Run(t, "money", map[string]vectors.Subject{
		"exponent": func(in json.RawMessage) (any, error) {
			currency, err := vectors.Decode[string](in)
			if err != nil {
				return nil, err
			}
			return money.Exponent(currency)
		},
		"money": func(in json.RawMessage) (any, error) {
			a, err := vectors.Decode[amount](in)
			if err != nil {
				return nil, err
			}
			m, err := whole(a)
			if err != nil {
				return nil, err
			}
			return money.New(m.AmountMinor, m.Currency)
		},
		"add": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct{ A, B money.Money }](in)
			if err != nil {
				return nil, err
			}
			return money.Add(v.A, v.B)
		},
		"subtract": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct{ A, B money.Money }](in)
			if err != nil {
				return nil, err
			}
			return money.Subtract(v.A, v.B)
		},
		"multiply": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Amount money.Money `json:"amount"`
				Factor string      `json:"factor"`
			}](in)
			if err != nil {
				return nil, err
			}
			return money.Multiply(v.Amount, v.Factor)
		},
		"convert": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Amount money.Money `json:"amount"`
				Rate   string      `json:"rate"`
				To     string      `json:"to"`
			}](in)
			if err != nil {
				return nil, err
			}
			return money.Convert(v.Amount, v.Rate, v.To)
		},
		"split": func(in json.RawMessage) (any, error) {
			v, err := vectors.Decode[struct {
				Total        money.Money    `json:"total"`
				Participants []string       `json:"participants"`
				Order        []string       `json:"order"`
				Weights      *[]json.Number `json:"weights"`
			}](in)
			if err != nil {
				return nil, err
			}
			var weights []int64
			if v.Weights != nil {
				weights = make([]int64, 0, len(*v.Weights))
				for _, w := range *v.Weights {
					n, err := strconv.ParseInt(w.String(), 10, 64)
					if err != nil {
						return nil, &money.Error{Code: money.InvalidWeight, Message: err.Error()}
					}
					weights = append(weights, n)
				}
			}
			shares, err := money.Split(v.Total, v.Participants, v.Order, weights)
			if err != nil {
				return nil, err
			}
			out := make([][]any, len(shares))
			for i, s := range shares {
				out[i] = []any{s.Participant, s.Amount.AmountMinor}
			}
			return out, nil
		},
	}, code)
}

func code(err error) string {
	var e *money.Error
	if errors.As(err, &e) {
		return string(e.Code)
	}
	return "not a refusal: " + err.Error()
}

// CI does not run `go generate`, so a currency added to packages/domain's table would stay
// unknown to the server; this renders the table again and compares.
func TestTheTableIsGeneratedFromTheClients(t *testing.T) {
	table, err := repo.ReadFile(codegen.Source)
	if err != nil {
		t.Fatal(err)
	}
	want, err := codegen.Render(table)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(codegen.FileName)
	if err != nil {
		t.Fatalf("read %s: %v", codegen.FileName, err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s is stale against %s; run `pnpm run gen`", codegen.FileName, codegen.Source)
	}
}

func TestRenderRefusesATableItCannotTrust(t *testing.T) {
	for name, src := range map[string]string{
		"not JSON":            `{`,
		"no currencies":       `{"published":"2026-09-17","exponents":{}}`,
		"a lower-case code":   `{"published":"2026-09-17","exponents":{"eur":2}}`,
		"a negative exponent": `{"published":"2026-09-17","exponents":{"EUR":-1}}`,
		"no publication date": `{"exponents":{"EUR":2}}`,
	} {
		if _, err := codegen.Render([]byte(src)); err == nil {
			t.Errorf("%s: rendered", name)
		}
	}
}

func TestCurrenciesAreTheTables(t *testing.T) {
	codes := money.Currencies()
	if len(codes) != 165 {
		t.Fatalf("%d currencies, want the 165 of ISO 4217 List One with a minor unit", len(codes))
	}
	for _, c := range codes {
		if _, err := money.Exponent(c); err != nil {
			t.Errorf("%s: %v", c, err)
		}
	}
}

func TestRoundHalfUp(t *testing.T) {
	for _, tc := range []struct{ n, d, want int64 }{
		{5, 2, 3}, {-5, 2, -3}, {4, 3, 1}, {-4, 3, -1}, {5, 3, 2}, {-5, 3, -2}, {0, 7, 0},
	} {
		if got := money.RoundHalfUp(big.NewInt(tc.n), big.NewInt(tc.d)); got.Int64() != tc.want {
			t.Errorf("%d / %d: got %s, want %d", tc.n, tc.d, got, tc.want)
		}
	}
}

func TestASplitAlwaysSumsToItsTotal(t *testing.T) {
	order := []string{"a", "b", "c", "d", "e", "f", "g"}
	for total := int64(-500); total <= 500; total += 7 {
		for n := 1; n <= len(order); n++ {
			participants := make([]string, n)
			weights := make([]int64, n)
			for i := range n {
				participants[i] = order[n-1-i]
				weights[i] = int64(i%3) + 1
			}
			shares, err := money.Split(money.Money{AmountMinor: total, Currency: "EUR"}, participants, order, weights)
			if err != nil {
				t.Fatal(err)
			}
			var sum int64
			for _, s := range shares {
				sum += s.Amount.AmountMinor
			}
			if sum != total {
				t.Fatalf("%d split %d ways sums to %d", total, n, sum)
			}
		}
	}
}
