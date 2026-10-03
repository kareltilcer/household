package storage

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/grant"
	"github.com/kareltilcer/household/server/internal/platform/httpx"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/reqctx"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
)

// Picture is the storage picture (FR-ST4, FR-HA14), getStorage: what the household keeps against
// its allowance, by module and by member, its derived overhead, its largest items with what
// deleting each would recover, and the trend of its daily samples.
type Picture struct {
	// Modules are the modules served, whose labels name the largest items (module.StorageSource):
	// the router's, which app.NewRouter gives a picture that names none.
	Modules *module.Registry
	// Allowance is what a household may store, Default when zero.
	Allowance Allowance
	Log       *slog.Logger
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

// Admin is the module whose view the picture needs (PRD modules/17 Permissions): the household
// settings, which the platform serves itself (internal/platform/household).
const Admin = "admin"

// Largest is how many of the largest items the picture lists, and TrendDays how many days of
// samples its trend covers.
const (
	Largest   = 10
	TrendDays = 90
)

// Routes registers getStorage, on the API's router, behind the tenant middleware.
func (p *Picture) Routes(r chi.Router) {
	r.Get("/households/{"+tenant.Param+"}/storage", p.picture)
}

// report is the contract's StorageReport.
type report struct {
	TotalBytes    int64        `json:"total_bytes"`
	IncludedBytes int64        `json:"included_bytes"`
	ObjectCount   int64        `json:"object_count"`
	ByModule      []moduleLine `json:"by_module"`
	ByMember      []memberLine `json:"by_member"`
	Largest       []item       `json:"largest"`
	Trend         []trendDay   `json:"trend"`
}

type moduleLine struct {
	Module       string `json:"module"`
	Bytes        int64  `json:"bytes"`
	DerivedBytes int64  `json:"derived_bytes"`
	ObjectCount  int64  `json:"object_count"`
}

type actorRef struct {
	UserID         uuid.UUID `json:"user_id"`
	Label          string    `json:"label"`
	IsFormerMember bool      `json:"is_former_member"`
}

type memberLine struct {
	User  actorRef `json:"user"`
	Bytes int64    `json:"bytes"`
}

type item struct {
	Module           string    `json:"module"`
	EntityID         uuid.UUID `json:"entity_id"`
	Label            string    `json:"label"`
	Bytes            int64     `json:"bytes"`
	RecoverableBytes int64     `json:"recoverable_bytes"`
}

type trendDay struct {
	Date  string `json:"date"`
	Bytes int64  `json:"bytes"`
}

// picture is getStorage. A member without view on the household settings is answered 404: the
// screen is absent for them (C-54). The totals are what the household keeps now, against the
// allowance its base and the blocks in effect come to; the trend is its samples. Every member's
// bytes count in the totals and the split by member, which say how much and whose, never what. The
// split by module leaves out every module the reader cannot see, which is absent for them (FR-AC2):
// its line would tell a member kept out of Finance that the household keeps Finance's files, and how
// many (D-16). The largest items leave out what the reader could not open, another member's private
// item, but for an owner a child profile's, which they may read (D-19), and anything in a module they
// cannot see (D-108), and name each as its module labels it, by its file's name where the module
// gives no label.
func (p *Picture) picture(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := grant.Require(ctx, Admin, access.View); err != nil {
		p.fail(w, r, err)
		return
	}
	scope := tenant.From(ctx)
	allowance := p.Allowance
	if allowance == (Allowance{}) {
		allowance = Default
	}
	now := time.Now
	if p.Now != nil {
		now = p.Now
	}
	out := report{IncludedBytes: allowance.Base, ByModule: []moduleLine{}, ByMember: []memberLine{}, Largest: []item{}, Trend: []trendDay{}}
	err := tenant.InTx(ctx, func(tx pgx.Tx) error {
		household := scope.HouseholdID()
		// The allowance is the base and the blocks the month's daily average has put in effect (FR-BI3).
		usage, err := ReadUsage(ctx, tx, household, now())
		if err != nil {
			return err
		}
		out.IncludedBytes = allowance.Standing(usage).Included
		rows, err := tx.Query(ctx, `
			SELECT module,
			  coalesce(sum(byte_size) FILTER (WHERE variant = 'original'), 0)::bigint,
			  coalesce(sum(byte_size) FILTER (WHERE variant <> 'original'), 0)::bigint,
			  count(*)
			FROM files WHERE household_id = $1 GROUP BY module ORDER BY sum(byte_size) DESC, module`, household)
		if err != nil {
			return err
		}
		modules, err := pgx.CollectRows(rows, pgx.RowToStructByPos[moduleLine])
		if err != nil {
			return err
		}
		visible := []string{}
		for _, m := range modules {
			out.TotalBytes += m.Bytes + m.DerivedBytes
			out.ObjectCount += m.ObjectCount
			// A module the reader cannot see, by their grant or because the household disables it,
			// counts in the totals, the household's against its allowance, and has no line of its own.
			if scope.Level(m.Module) >= access.View {
				visible = append(visible, m.Module)
				out.ByModule = append(out.ByModule, m)
			}
		}

		rows, err = tx.Query(ctx, `
			SELECT f.owner_id, u.display_name,
			  NOT EXISTS (SELECT FROM memberships m WHERE m.household_id = f.household_id AND m.user_id = f.owner_id),
			  sum(f.byte_size)::bigint
			FROM files f JOIN users u ON u.id = f.owner_id
			WHERE f.household_id = $1
			GROUP BY f.household_id, f.owner_id, u.display_name
			ORDER BY sum(f.byte_size) DESC, f.owner_id`, household)
		if err != nil {
			return err
		}
		var line memberLine
		if _, err := pgx.ForEachRow(rows, []any{&line.User.UserID, &line.User.Label, &line.User.IsFormerMember, &line.Bytes}, func() error {
			out.ByMember = append(out.ByMember, line)
			return nil
		}); err != nil {
			return err
		}

		if err := p.largest(ctx, tx, scope, visible, &out); err != nil {
			return err
		}

		today := now().UTC()
		since := time.Date(today.Year(), today.Month(), today.Day()-(TrendDays-1), 0, 0, 0, 0, time.UTC)
		rows, err = tx.Query(ctx, `
			SELECT to_char(sampled_on, 'YYYY-MM-DD'), stored_bytes FROM usage_samples
			WHERE household_id = $1 AND sampled_on >= $2 ORDER BY sampled_on`, household, since)
		if err != nil {
			return err
		}
		out.Trend, err = pgx.CollectRows(rows, pgx.RowToStructByPos[trendDay])
		return err
	})
	if err != nil {
		p.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// largest fills in the largest items of scope's household its reader may open: by what deleting each
// would recover, its original and every variant derived from it, summed for every entity in one pass
// over the household's rows rather than once for each of its originals. A private item is the
// reader's to open when it is their own, and, for an owner, when it is a child profile's, whose
// private items D-19 makes readable by the household's owners (FR-CH3), as a link to its file is
// issued to them (files.Service.Link).
func (p *Picture) largest(ctx context.Context, tx pgx.Tx, scope *tenant.Scope, visible []string, out *report) error {
	rows, err := tx.Query(ctx, `
		SELECT o.module, o.entity_id, coalesce(o.filename, ''), o.byte_size, e.bytes
		FROM files o
		JOIN (SELECT module, entity_id, sum(byte_size)::bigint AS bytes FROM files
		      WHERE household_id = $1 AND module = ANY($2) GROUP BY module, entity_id) e
		  ON e.module = o.module AND e.entity_id = o.entity_id
		WHERE o.household_id = $1 AND o.variant = 'original' AND o.module = ANY($2)
		  AND (NOT o.private OR o.owner_id = $3
		       OR ($5 AND EXISTS (SELECT FROM memberships m
		                          WHERE m.household_id = o.household_id AND m.user_id = o.owner_id AND m.role = 'child')))
		ORDER BY e.bytes DESC, o.entity_id
		LIMIT $4`, scope.HouseholdID(), visible, scope.UserID(), Largest, scope.Role() == access.Owner)
	if err != nil {
		return err
	}
	if out.Largest, err = pgx.CollectRows(rows, pgx.RowToStructByPos[item]); err != nil {
		return err
	}
	byModule := map[string][]uuid.UUID{}
	for _, it := range out.Largest {
		byModule[it.Module] = append(byModule[it.Module], it.EntityID)
	}
	for name, ids := range byModule {
		m, ok := p.Modules.Lookup(name)
		if !ok {
			continue
		}
		src, ok := m.(module.StorageSource)
		if !ok {
			continue
		}
		labels, err := src.StorageLabels(ctx, tx, ids)
		if err != nil {
			return err
		}
		for i, it := range out.Largest {
			if label, ok := labels[it.EntityID]; ok && it.Module == name {
				out.Largest[i].Label = label
			}
		}
	}
	return nil
}

// fail answers err's problem, or 500 for an error that is not one, which it logs.
func (p *Picture) fail(w http.ResponseWriter, r *http.Request, err error) {
	var pr *problem.Problem
	if !errors.As(err, &pr) {
		p.Log.LogAttrs(r.Context(), slog.LevelError, "storage picture failed", slog.Any("error", err))
	}
	problem.Write(w, reqctx.RequestID(r.Context()), err)
}
