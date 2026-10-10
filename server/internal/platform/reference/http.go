package reference

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/etag"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// countryParam is the path parameter that names a country, as the contract declares it.
const countryParam = "country"

// Routes returns the reference reads, for the router mounted at /reference (getReferenceCountries,
// getReferenceCountriesByCountry, getReferenceUnits). They answer every authenticated caller alike
// and anyone else 401 (auth.Required). pool opens their transactions, as the request role; log
// records a read that failed.
func Routes(pool tenant.Beginner, log *slog.Logger) func(chi.Router) {
	h := handler{pool: pool, log: log}
	return func(r chi.Router) {
		r.Use(auth.Required)
		r.Get("/countries", h.countries)
		r.Get("/countries/{"+countryParam+"}", h.country)
		r.Get("/units", h.units)
	}
}

type handler struct {
	pool tenant.Beginner
	log  *slog.Logger
}

// countryJSON is the contract's Country: a profile as the reads serve it, every name in every
// language, so that a client renders it in its member's language however often that changes.
type countryJSON struct {
	Code               string    `json:"code"`
	Version            int64     `json:"version"`
	Name               Localized `json:"name"`
	Currency           string    `json:"currency"`
	VATStandardPercent string    `json:"vat_standard_percent"`
	DefaultUnits       string    `json:"default_units"`
	FirstDayOfWeek     int       `json:"first_day_of_week"`
	HolidaySet         string    `json:"holiday_set"`
	InspectionLabel    string    `json:"inspection_label"`
	DocumentTypeSet    string    `json:"document_type_set"`
	// SupervisoryAuthority is the contract's SupervisoryAuthority.
	SupervisoryAuthority authorityJSON `json:"supervisory_authority"`
}

// authorityJSON is the contract's SupervisoryAuthority: whom a person in the country complains to
// about their personal data, and the address of the authority's page for it.
type authorityJSON struct {
	Name Localized `json:"name"`
	URL  string    `json:"url"`
}

// countryColumns are countryJSON's columns, in the order scanCountry reads them.
const countryColumns = `code, version, name, currency, vat_standard_percent::text, default_units::text,
	first_day_of_week, holiday_set, inspection_label, document_type_set,
	supervisory_authority_name, supervisory_authority_url`

// scanCountry reads a row of countryColumns. A profile no load has given its authority does not
// scan, and the read fails rather than answer a profile the contract does not admit: one between
// migration 01026 and the load that follows it in the same migrate, or one an administrator edited
// before that migration, which the loader leaves as it is until its file agrees with it (D-148).
func scanCountry(row pgx.CollectableRow) (countryJSON, error) {
	var (
		c       countryJSON
		address *string
	)
	err := row.Scan(&c.Code, &c.Version, &c.Name, &c.Currency, &c.VATStandardPercent, &c.DefaultUnits, &c.FirstDayOfWeek,
		&c.HolidaySet, &c.InspectionLabel, &c.DocumentTypeSet, &c.SupervisoryAuthority.Name, &address)
	if err != nil {
		return c, err
	}
	if address == nil {
		return c, fmt.Errorf("reference: the profile of %s has no supervisory authority: no load has given it one", c.Code)
	}
	c.SupervisoryAuthority.URL = *address
	return c, nil
}

// countryListJSON is the contract's CountryList.
type countryListJSON struct {
	Version int64         `json:"version"`
	Items   []countryJSON `json:"items"`
}

// dimensionJSON is the contract's UnitDimension.
type dimensionJSON struct {
	Key      string    `json:"key"`
	Version  int64     `json:"version"`
	Name     Localized `json:"name"`
	BaseUnit string    `json:"base_unit"`
}

// unitJSON is the contract's Unit.
type unitJSON struct {
	Key         string     `json:"key"`
	Version     int64      `json:"version"`
	Dimension   string     `json:"dimension"`
	System      string     `json:"system"`
	Symbol      string     `json:"symbol"`
	CLDR        string     `json:"cldr"`
	Name        Localized  `json:"name"`
	ToBase      Conversion `json:"to_base"`
	Counterpart *string    `json:"counterpart"`
}

// unitListJSON is the contract's UnitList.
type unitListJSON struct {
	Version    int64           `json:"version"`
	Dimensions []dimensionJSON `json:"dimensions"`
	Units      []unitJSON      `json:"units"`
}

// countries answers every country profile, in the order of their codes.
func (h handler) countries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := countryListJSON{Items: []countryJSON{}}
	err := h.read(ctx, func(tx pgx.Tx) error {
		var err error
		if body.Version, err = datasetVersion(ctx, tx, Countries); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, "SELECT "+countryColumns+" FROM country_profiles ORDER BY code")
		if err != nil {
			return err
		}
		body.Items, err = pgx.AppendRows(body.Items, rows, scanCountry)
		return err
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

// country answers one country's profile, with its version as the ETag, or 404 for a country
// Household has no profile of.
func (h handler) country(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var c countryJSON
	err := h.read(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "SELECT "+countryColumns+" FROM country_profiles WHERE code = $1",
			chi.URLParam(r, countryParam))
		if err != nil {
			return err
		}
		c, err = pgx.CollectExactlyOneRow(rows, scanCountry)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.NotFound()
		}
		return err
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	etag.Set(w, c.Version)
	httpx.WriteJSON(w, http.StatusOK, c)
}

// units answers every dimension and every unit: the dimensions in the order of their keys, and
// the units by dimension, metric first, each system's from the smallest.
func (h handler) units(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := unitListJSON{Dimensions: []dimensionJSON{}, Units: []unitJSON{}}
	err := h.read(ctx, func(tx pgx.Tx) error {
		var err error
		if body.Version, err = datasetVersion(ctx, tx, Units); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, "SELECT key, version, name, base_unit FROM unit_dimensions ORDER BY key")
		if err != nil {
			return err
		}
		if body.Dimensions, err = pgx.AppendRows(body.Dimensions, rows, pgx.RowToStructByPos[dimensionJSON]); err != nil {
			return err
		}
		// Ordered by the table's columns, not the output's: system, as text, would sort imperial first.
		rows, err = tx.Query(ctx, `
			SELECT u.key, u.version, u.dimension, u.system::text, u.symbol, u.cldr, u.name,
			  u.to_base_offset::text, u.to_base_numerator::text, u.to_base_denominator::text, u.counterpart
			FROM units u
			ORDER BY u.dimension, u.system, u.to_base_numerator / u.to_base_denominator, u.key`)
		if err != nil {
			return err
		}
		body.Units, err = pgx.AppendRows(body.Units, rows, func(row pgx.CollectableRow) (unitJSON, error) {
			var u unitJSON
			err := row.Scan(&u.Key, &u.Version, &u.Dimension, &u.System, &u.Symbol, &u.CLDR, &u.Name,
				&u.ToBase.Offset, &u.ToBase.Numerator, &u.ToBase.Denominator, &u.Counterpart)
			return u, err
		})
		return err
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

// datasetVersion returns the version of the dataset name, 0 for one never loaded.
func datasetVersion(ctx context.Context, tx pgx.Tx, name string) (int64, error) {
	var version int64
	err := tx.QueryRow(ctx, "SELECT coalesce((SELECT version FROM reference_datasets WHERE name = $1), 0)", name).Scan(&version)
	return version, err
}

// read runs fn in a read-only transaction as the request role. The tables are global, so the
// transaction carries no household; setting the role holds it to the request role's privileges
// even on a pool that connected as a role above it, as tenant.InTx does. The transaction is
// repeatable read, so that its statements share one snapshot: a load that commits between them
// cannot pair a dataset's version with rows of another, or a unit with a dimension the answer
// does not list.
func (h handler) read(ctx context.Context, fn func(pgx.Tx) error) error {
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	return pgx.BeginTxFunc(ctx, h.pool, options, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT set_config('role', $1, true)", db.RoleApp); err != nil {
			return err
		}
		return fn(tx)
	})
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (h handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	var p *problem.Problem
	if !errors.As(err, &p) {
		h.log.LogAttrs(r.Context(), slog.LevelError, "reference read failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}
