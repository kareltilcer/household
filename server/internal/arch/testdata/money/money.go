// Package money is architecture test 8's fixture: Go that breaks the money rule, beside Go
// that keeps it. It is never compiled; the test parses it.
package money

import (
	"database/sql"
	"math/big"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"
)

// Violations.

type Expense struct {
	ID          string
	Amount      float64
	UnitPrice   *big.Float
	Fees        []float32
	Settled     decimal.Decimal `json:"balance"`
	AmountMinor int64
	Currency    string
}

type Price float64

func Total(prices []float64, taxRate float32) (totalCost float64) { return 0 }

var budget float64

func Split(amounts ...float64) {}

type Refund struct {
	Amount   sql.NullFloat64
	Fee      sql.Null[float64]
	Charge   pgtype.Float8
	Deposits chan float64
}

// Kept.

type Harvest struct {
	QuantityKg   float64
	SeasonTotal  float64
	FxRate       string
	AmountMinor  int64 `json:"amount_minor"`
	ChargeKwh    float64
	DiscountPct  float64
	Temperature  float64
	PriceMinor   int64
	BalanceMinor int64
	WeightKg     sql.Null[float64]
	CostMinor    sql.Null[int64]
}

func Ratio(a, b float64) float64 { return a / b }
