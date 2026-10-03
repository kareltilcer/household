package billing

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/kareltilcer/household/server/internal/platform/money"
)

// The intervals a subscription is billed at, as the contract's Subscription spells them.
const (
	Year  = "year"
	Month = "month"
)

// Fallback is the currency a household whose base currency has no plan is charged in (PRD 04 §1:
// "else EUR"). CZK and PLN are charged in it until their figures are configured (D-130).
const Fallback = "EUR"

// Price is one price of a plan: what it charges, in the currency's minor unit, and the processor's
// price that charges it, "" when none is configured.
type Price struct {
	AmountMinor int64  `json:"amount_minor"`
	ID          string `json:"price"`
}

// Plan is what a household pays in one currency (PRD 04 §1): the base fee for a year paid at once
// and for a month, and a 10 GB block of storage for a month. The prices are set per currency, never
// converted.
type Plan struct {
	Currency string `json:"-"`
	Year     Price  `json:"year"`
	Month    Price  `json:"month"`
	Block    Price  `json:"block"`
}

// prices are the plan's three, each by the name a deployment configures it under, in order.
func (p Plan) prices() []namedPrice {
	return []namedPrice{{Year, p.Year}, {Month, p.Month}, {"block", p.Block}}
}

// namedPrice is one price of a plan with its name.
type namedPrice struct {
	name  string
	price Price
}

// Base is the plan's base fee billed each interval.
func (p Plan) Base(interval string) Price {
	if interval == Year {
		return p.Year
	}
	return p.Month
}

// Prices are the plans, by currency. Fallback's is always among them.
type Prices map[string]Plan

// DefaultPrices are PRD 04 §1's launch figures, with no processor's prices: €4.99 a month paid
// annually (€59.88), €5.99 month to month and €1.00 a block; £4.49 a month paid annually (£53.88),
// £5.49 month to month and £1.00 a block.
func DefaultPrices() Prices {
	return Prices{
		"EUR": {Currency: "EUR", Year: Price{AmountMinor: 5988}, Month: Price{AmountMinor: 599}, Block: Price{AmountMinor: 100}},
		"GBP": {Currency: "GBP", Year: Price{AmountMinor: 5388}, Month: Price{AmountMinor: 549}, Block: Price{AmountMinor: 100}},
	}
}

// ParsePrices reads the plans a deployment configures (HOUSEHOLD_BILLING_PRICES): a JSON object of
// currency to its year, month and block, each an amount in minor units and the processor's price,
//
//	{"EUR": {"year": {"amount_minor": 5988, "price": "price_…"}, "month": {…}, "block": {…}}}
//
// Every currency is ISO 4217's, every amount positive, and Fallback is among them.
func ParsePrices(raw string) (Prices, error) {
	dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
	dec.DisallowUnknownFields()
	var plans map[string]Plan
	if err := dec.Decode(&plans); err != nil {
		return nil, fmt.Errorf("billing: the prices are not the JSON they should be: %w", err)
	}
	if dec.More() {
		return nil, errors.New("billing: the prices are followed by something else")
	}
	out := Prices{}
	for _, currency := range slices.Sorted(maps.Keys(plans)) {
		plan := plans[currency]
		if _, err := money.Exponent(currency); err != nil {
			return nil, fmt.Errorf("billing: %q is not an ISO 4217 currency", currency)
		}
		for _, named := range plan.prices() {
			if named.price.AmountMinor <= 0 {
				return nil, fmt.Errorf("billing: %s's %s price is not a positive amount of minor units", currency, named.name)
			}
		}
		plan.Currency = currency
		out[currency] = plan
	}
	if _, ok := out[Fallback]; !ok {
		return nil, fmt.Errorf("billing: the prices name no %s plan, which every other currency falls back to", Fallback)
	}
	return out, nil
}

// For is the plan a household whose base currency is currency pays: its own where one is set, and
// Fallback's otherwise.
func (p Prices) For(currency string) Plan {
	if plan, ok := p[currency]; ok {
		return plan
	}
	return p[Fallback]
}

// Unpriced names each price of p that has no processor's price, as "EUR year", in order: what a
// deployment that takes payments must not have.
func (p Prices) Unpriced() []string {
	var out []string
	for _, currency := range slices.Sorted(maps.Keys(p)) {
		for _, named := range p[currency].prices() {
			if named.price.ID == "" {
				out = append(out, currency+" "+named.name)
			}
		}
	}
	return out
}
