package mutation_test

import (
	"bytes"
	"context"
	"embed"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/auth"
	"github.com/kareltilcer/household/server/internal/platform/db"
	"github.com/kareltilcer/household/server/internal/platform/entity"
	"github.com/kareltilcer/household/server/internal/platform/idempotency"
	"github.com/kareltilcer/household/server/internal/platform/idgen"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/mutation"
	"github.com/kareltilcer/household/server/internal/platform/problem"
	"github.com/kareltilcer/household/server/internal/platform/sync"
	"github.com/kareltilcer/household/server/internal/platform/tenant"
	"github.com/kareltilcer/household/server/internal/platform/testsupport"
)

//go:embed testdata/migrations/*.sql
var migrations embed.FS

// spine is a module for these tests: a table, two audit actions, an entity whose rows are
// shared and one whose rows may be private.
type spine struct{}

func (spine) Name() string { return "spine" }

func (spine) Migrations() fs.FS {
	sub, err := fs.Sub(migrations, "testdata/migrations")
	if err != nil {
		panic(err)
	}
	return sub
}

func (spine) RegisterRoutes(chi.Router) {}

func (spine) AuditActions() []module.AuditAction {
	return []module.AuditAction{
		{Key: "spine.item.create", SummaryKey: "spine.item.create"},
		{Key: "spine.item.update", SummaryKey: "spine.item.update"},
	}
}

func (spine) SyncEntities() []sync.Entity {
	return []sync.Entity{
		{Name: "spine.item", Table: "spine_items", Policy: sync.LWWField, Access: sync.Grant},
		{Name: "spine.note", Table: "spine_items", Policy: sync.LWWField, Access: sync.Grant | sync.Owner},
	}
}

// other is a second module, whose entity a spine mutation may not change.
type other struct{}

func (other) Name() string                       { return "other" }
func (other) Migrations() fs.FS                  { return nil }
func (other) RegisterRoutes(chi.Router)          {}
func (other) AuditActions() []module.AuditAction { return nil }
func (other) SyncEntities() []sync.Entity {
	return []sync.Entity{{Name: "other.thing", Table: "spine_items", Policy: sync.LWWField, Access: sync.Grant}}
}

func newRegistry() *module.Registry {
	reg, err := module.NewRegistry(spine{}, other{})
	if err != nil {
		panic(err)
	}
	return reg
}

func TestMain(m *testing.M) { testsupport.Main(m, newRegistry().Blocks()...) }

// world is one test's pools, the administrator's to arrange and check rows and the request
// role's to serve, and the registry the spine checks mutations against.
type world struct {
	t     *testing.T
	admin *pgxpool.Pool
	app   *pgxpool.Pool
	reg   *module.Registry
}

func newWorld(t *testing.T) *world {
	d := testsupport.Open(t)
	return &world{t: t, admin: d.Pool(t, ""), app: d.Pool(t, db.RoleApp), reg: newRegistry()}
}

func (w *world) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.Exec(context.Background(), sql, args...); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
}

func (w *world) count(sql string, args ...any) int {
	w.t.Helper()
	var n int
	if err := w.admin.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// member creates a household and its owner.
func (w *world) member() (household, user uuid.UUID) {
	w.t.Helper()
	household, user = idgen.New(), idgen.New()
	w.exec(testsupport.InsertHousehold, household)
	w.exec("INSERT INTO users (id) VALUES ($1)", user)
	w.exec(testsupport.InsertMember, household, user, "owner")
	return household, user
}

// serve sends a request as user to household through the platform's household middleware, the
// tenant, the catalog and the Idempotency-Key, into handler, and returns the response. It
// arrives via the web.
func (w *world) serve(household, user uuid.UUID, header http.Header, handler http.HandlerFunc) *httptest.ResponseRecorder {
	tenancy, err := tenant.Middleware(tenant.Config{Pool: w.app, Logger: slog.New(slog.DiscardHandler)})
	if err != nil {
		w.t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Route("/households/{"+tenant.Param+"}", func(h chi.Router) {
		h.Use(tenancy, mutation.Catalog(w.reg), idempotency.Middleware(slog.New(slog.DiscardHandler), 1<<20))
		h.Post("/x", handler)
	})
	ctx := auth.WithUser(mutation.WithVia(context.Background(), audit.ViaWeb), user)
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/households/"+household.String()+"/x", nil)
	for key, values := range header {
		req.Header[key] = values
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// in runs fn in a request of user's in household, and fails the test unless the request
// reached it.
func (w *world) in(household, user uuid.UUID, fn func(ctx context.Context)) {
	reached := false
	rec := w.serve(household, user, nil, func(rw http.ResponseWriter, r *http.Request) {
		reached = true
		fn(r.Context())
		rw.WriteHeader(http.StatusNoContent)
	})
	if !reached {
		w.t.Errorf("the request did not reach its handler: %d %s", rec.Code, rec.Body)
	}
}

// create is a mutation that creates the spine item id, titled title, and records it.
func create(ctx context.Context, id uuid.UUID, title string) func(pgx.Tx) (mutation.Record, error) {
	return func(tx pgx.Tx) (mutation.Record, error) {
		var version int64
		if err := tx.QueryRow(ctx, "INSERT INTO spine_items (id, household_id, title) VALUES ($1, app_household_id(), $2) RETURNING version",
			id, title).Scan(&version); err != nil {
			return mutation.Record{}, err
		}
		return mutation.Record{
			Event: audit.Event{
				Module: "spine", Action: "item.create", EntityType: "spine.item", EntityID: id,
				SummaryKey: "spine.item.create", SummaryArgs: map[string]any{"title": title},
				Changes: []audit.Change{{Field: "title", New: title}},
			},
			Changes: []sync.Change{{Entity: "spine.item", ID: id, Op: sync.Upsert, Version: version, Row: map[string]any{"id": id, "title": title}}},
		}, nil
	}
}

// written counts what a mutation of the spine item id left behind: the item and its audit events.
func (w *world) written(id uuid.UUID) (items, events int) {
	w.t.Helper()
	return w.count("SELECT count(*) FROM spine_items WHERE id = $1", id),
		w.count("SELECT count(*) FROM audit_events WHERE entity_id = $1", id)
}

// The row and its audit event with its diff commit together, with the actor and how the change
// arrived; and the change feed, which nothing reads under D-93, is no longer written (D-121).
func TestApplyWritesTheRowAndTheEvent(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	var res mutation.Result
	w.in(h, u, func(ctx context.Context) {
		var err error
		if res, err = mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Fatal(err)
		}
	})
	if items, events := w.written(id); items != 1 || events != 1 {
		t.Fatalf("wrote %d items, %d events; want one of each", items, events)
	}

	var (
		createdBy, actor         uuid.UUID
		version                  int64
		actorType, via, argTitle string
		diff                     []byte
	)
	if err := w.admin.QueryRow(t.Context(), `
		SELECT i.created_by, i.version, e.actor_id, e.actor_type::text, e.meta->>'via', e.summary_args->>'title', c.new_value
		FROM spine_items i
		JOIN audit_events e ON e.entity_id = i.id AND e.id = $2
		JOIN audit_changes c ON c.event_id = e.id AND c.field = 'title'
		WHERE i.id = $1`, id, res.EventID).Scan(&createdBy, &version, &actor, &actorType, &via, &argTitle, &diff); err != nil {
		t.Fatal(err)
	}
	if createdBy != u || version != 1 || actor != u || actorType != "user" || via != "web" || argTitle != "Milk" || string(diff) != `"Milk"` {
		t.Fatalf("created_by %s version %d, actor %s %s via %s, args title %q, diff %s", createdBy, version, actor, actorType, via, argTitle, diff)
	}
	if n := w.count("SELECT count(*) FROM sync_changes WHERE household_id = $1", h); n != 0 {
		t.Fatalf("the spine wrote %d rows of the change feed, which it writes no longer", n)
	}
}

// An event is labelled with its actor's display name as it was when the event was written, so
// that it still reads after a rename; an actor with no name is labelled NULL.
func TestAnEventIsLabelledWithItsActorsName(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	label := func(title string) *string {
		t.Helper()
		id := idgen.New()
		w.in(h, u, func(ctx context.Context) {
			if _, err := mutation.Apply(ctx, create(ctx, id, title)); err != nil {
				t.Fatal(err)
			}
		})
		var l *string
		if err := w.admin.QueryRow(t.Context(), "SELECT actor_label FROM audit_events WHERE entity_id = $1", id).Scan(&l); err != nil {
			t.Fatal(err)
		}
		return l
	}
	if l := label("Bread"); l != nil {
		t.Fatalf("an actor with no name is labelled %q", *l)
	}
	w.exec("UPDATE users SET display_name = 'Jana' WHERE id = $1", u)
	first := label("Milk")
	w.exec("UPDATE users SET display_name = 'Jana Tilcerová' WHERE id = $1", u)
	second := label("Eggs")
	if first == nil || *first != "Jana" || second == nil || *second != "Jana Tilcerová" {
		t.Fatalf("labels %v and %v", first, second)
	}
	var kept string
	if err := w.admin.QueryRow(t.Context(), "SELECT actor_label FROM audit_events WHERE summary_args->>'title' = 'Milk' AND household_id = $1", h).Scan(&kept); err != nil || kept != "Jana" {
		t.Fatalf("the earlier event's label became %q (%v)", kept, err)
	}
}

// A field with no value is NULL in its diff however the mutation spells it, nil or a nil
// pointer, and never the JSON null.
func TestADiffOfNoValueIsNull(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
			rec, err := create(ctx, id, "Milk")(tx)
			rec.Event.Changes = []audit.Change{
				{Field: "title", Old: (*string)(nil), New: "Milk"},
				{Field: "note", Old: nil, New: (*string)(nil)},
			}
			return rec, err
		})
		if err != nil {
			t.Fatal(err)
		}
	})
	if n := w.count(`SELECT count(*) FROM audit_changes c JOIN audit_events e ON e.household_id = c.household_id AND e.id = c.event_id
		WHERE e.entity_id = $1 AND c.old_value IS NULL AND (c.field = 'note') = (c.new_value IS NULL)`, id); n != 2 {
		t.Fatalf("%d of the 2 diffs store no value as NULL", n)
	}
}

// A mutation's writes, its event and its change roll back together: when the mutation fails, when
// its event cannot be recorded, and when its change's row does not serialise, or serialises to null.
func TestApplyRollsBackTogether(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	for name, spoil := range map[string]func(*mutation.Record) error{
		"the mutation fails":                    func(*mutation.Record) error { return errors.New("refused") },
		"the event cannot be recorded":          func(r *mutation.Record) error { r.Event.Meta = map[string]any{"bad": make(chan int)}; return nil },
		"the change's row cannot be serialised": func(r *mutation.Record) error { r.Changes[0].Row = make(chan int); return nil },
		"the change's row is nil":               func(r *mutation.Record) error { r.Changes[0].Row = (*struct{})(nil); return nil },
	} {
		t.Run(name, func(t *testing.T) {
			id := idgen.New()
			w.in(h, u, func(ctx context.Context) {
				_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
					rec, err := create(ctx, id, "Milk")(tx)
					if err != nil {
						return rec, err
					}
					return rec, spoil(&rec)
				})
				if err == nil {
					t.Error("Apply succeeded")
				}
			})
			if items, events := w.written(id); items+events != 0 {
				t.Fatalf("left %d items, %d events", items, events)
			}
		})
	}
}

// A mutation that reports an event without a change, or a change without an event, is refused
// and rolled back.
func TestApplyRefusesAHalfRecord(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	for name, strip := range map[string]func(mutation.Record) mutation.Record{
		"no change":   func(r mutation.Record) mutation.Record { r.Changes = nil; return r },
		"no event":    func(r mutation.Record) mutation.Record { r.Event = audit.Event{}; return r },
		"no module":   func(r mutation.Record) mutation.Record { r.Event.Module = ""; return r },
		"half events": func(r mutation.Record) mutation.Record { r.Event.Action = ""; return r },
	} {
		t.Run(name, func(t *testing.T) {
			id := idgen.New()
			w.in(h, u, func(ctx context.Context) {
				_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
					rec, err := create(ctx, id, "Milk")(tx)
					return strip(rec), err
				})
				if err == nil {
					t.Error("Apply succeeded")
				}
			})
			if items, events := w.written(id); items+events != 0 {
				t.Fatalf("left %d items, %d events", items, events)
			}
		})
	}
}

// A mutation that reports nothing is rolled back, whatever it wrote: an insert, an update or a
// delete it forgot to report is undone rather than committed without its audit event and its
// change, and so is a duplicate insert its savepoint refused.
func TestApplyRollsBackAMutationThatReportsNothing(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	existing, inserted := idgen.New(), idgen.New()
	w.in(h, u, func(ctx context.Context) {
		if _, err := mutation.Apply(ctx, create(ctx, existing, "Milk")); err != nil {
			t.Fatal(err)
		}
	})
	for name, write := range map[string]func(context.Context, pgx.Tx) error{
		"an insert": func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "INSERT INTO spine_items (id, household_id, title) VALUES ($1, app_household_id(), 'Bread')", inserted)
			return err
		},
		"an update": func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "UPDATE spine_items SET title = 'Oat milk' WHERE id = $1", existing)
			return err
		},
		"a delete": func(ctx context.Context, tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "DELETE FROM spine_items WHERE id = $1", existing)
			return err
		},
		"a duplicate insert its savepoint undid": func(ctx context.Context, tx pgx.Tx) error {
			savepoint, err := tx.Begin(ctx)
			if err != nil {
				return err
			}
			_, err = savepoint.Exec(ctx, "INSERT INTO spine_items (id, household_id, title) VALUES ($1, app_household_id(), 'Milk')", existing)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23505" { // unique_violation
				t.Errorf("the duplicate insert: %v, want unique_violation", err)
			}
			return savepoint.Rollback(ctx)
		},
	} {
		w.in(h, u, func(ctx context.Context) {
			res, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
				return mutation.Record{}, write(ctx, tx)
			})
			if err != nil || res != (mutation.Result{}) {
				t.Errorf("%s reported as nothing: %v, %+v; want a zero result", name, err, res)
			}
		})
	}
	if n := w.count("SELECT count(*) FROM spine_items WHERE id = $1 AND title = 'Milk' AND version = 1", existing); n != 1 {
		t.Fatal("an update or a delete reported as nothing was committed")
	}
	if items, _ := w.written(inserted); items != 0 {
		t.Fatal("an insert reported as nothing was committed")
	}
}

// A mutation that finds nothing to change records nothing and succeeds: whether it found it by a
// read, by a row it locked, or by an upsert whose update did not apply.
func TestApplyWithNothingToDoRecordsNothing(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Fatal(err)
		}
	})
	before := w.count("SELECT count(*) FROM audit_events WHERE household_id = $1", h)
	for name, stmt := range map[string]string{
		"a read":    "SELECT id FROM spine_items WHERE id = $1",
		"a lock":    "SELECT id FROM spine_items WHERE id = $1 FOR UPDATE",
		"a no-op":   "UPDATE spine_items SET title = 'Milk' WHERE id = $1 AND title <> 'Milk' RETURNING id",
		"an upsert": "INSERT INTO spine_items (id, household_id, title) VALUES ($1, app_household_id(), 'Milk') ON CONFLICT (id) DO UPDATE SET title = excluded.title WHERE spine_items.title <> excluded.title RETURNING id",
	} {
		w.in(h, u, func(ctx context.Context) {
			res, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
				rows, err := tx.Query(ctx, stmt, id)
				if err != nil {
					return mutation.Record{}, err
				}
				rows.Close()
				return mutation.Record{}, rows.Err()
			})
			if err != nil || res != (mutation.Result{}) {
				t.Errorf("a mutation with nothing to do, found by %s: %v, %+v", name, err, res)
			}
		})
	}
	if after := w.count("SELECT count(*) FROM audit_events WHERE household_id = $1", h); after != before {
		t.Fatalf("recorded %d events", after-before)
	}
	if n := w.count("SELECT count(*) FROM spine_items WHERE id = $1 AND version = 1", id); n != 1 {
		t.Fatal("a mutation with nothing to do changed the row")
	}
}

// A record is checked against what its module declares: an action it does not declare, an
// entity no module declares, another module's entity, a change its entity's access does not
// admit, and a private change in an event not private to its owner are refused, and nothing is
// written.
func TestApplyChecksTheRecordAgainstTheModules(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	for name, spoil := range map[string]func(*mutation.Record){
		"an undeclared action":         func(r *mutation.Record) { r.Event.Action = "item.explode" },
		"an undeclared entity":         func(r *mutation.Record) { r.Changes[0].Entity = "spine.ghost" },
		"another module's entity":      func(r *mutation.Record) { r.Changes[0].Entity = "other.thing" },
		"a private row that cannot be": func(r *mutation.Record) { r.Changes[0].Visibility = sync.Private; r.Changes[0].Owner = u },
		"a private row with no owner": func(r *mutation.Record) {
			r.Changes[0].Entity, r.Changes[0].Visibility = "spine.note", sync.Private
		},
		"a private row in a shared event": func(r *mutation.Record) {
			r.Changes[0].Entity, r.Changes[0].Visibility, r.Changes[0].Owner = "spine.note", sync.Private, u
		},
		"a private row in another's private event": func(r *mutation.Record) {
			r.Changes[0].Entity, r.Changes[0].Visibility, r.Changes[0].Owner = "spine.note", sync.Private, u
			r.Event.Visibility, r.Event.Owner = audit.Private, idgen.New()
		},
		"a row on a delete":         func(r *mutation.Record) { r.Changes[0].Op = sync.Delete },
		"no version":                func(r *mutation.Record) { r.Changes[0].Version = 0 },
		"an op of its own":          func(r *mutation.Record) { r.Changes[0].Op = "retract" },
		"an event with a bad level": func(r *mutation.Record) { r.Event.Level = "loud" },
	} {
		t.Run(name, func(t *testing.T) {
			id := idgen.New()
			w.in(h, u, func(ctx context.Context) {
				_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
					rec, err := create(ctx, id, "Milk")(tx)
					spoil(&rec)
					return rec, err
				})
				if err == nil {
					t.Error("Apply succeeded")
				}
			})
			if items, events := w.written(id); items+events != 0 {
				t.Fatalf("left %d items, %d events", items, events)
			}
		})
	}

	// A private row of an entity that may have them, with its owner, in an event private to them,
	// is written.
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
			rec, err := create(ctx, id, "Diary")(tx)
			rec.Changes[0].Entity, rec.Changes[0].Visibility, rec.Changes[0].Owner = "spine.note", sync.Private, u
			rec.Event.Visibility, rec.Event.Owner = audit.Private, u
			return rec, err
		})
		if err != nil {
			t.Fatal(err)
		}
	})
	if n := w.count("SELECT count(*) FROM audit_events WHERE entity_id = $1 AND visibility = 'private' AND owner_id = $2", id, u); n != 1 {
		t.Fatalf("%d private events, want 1", n)
	}
}

// Apply needs what the router carries into a household-scoped request: the tenant, the
// registry and how the change arrived.
func TestApplyNeedsItsContext(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	nothing := func(pgx.Tx) (mutation.Record, error) { return mutation.Record{}, nil }
	if _, err := mutation.Apply(mutation.WithCatalog(mutation.WithVia(t.Context(), audit.ViaWeb), w.reg), nothing); !errors.Is(err, tenant.ErrNoTenant) {
		t.Errorf("no tenant: %v", err)
	}
	w.in(h, u, func(ctx context.Context) {
		if _, err := mutation.Apply(mutation.WithVia(ctx, ""), nothing); !errors.Is(err, mutation.ErrNoVia) {
			t.Errorf("no via: %v", err)
		}
		if _, err := mutation.Apply(mutation.WithCatalog(ctx, nil), nothing); !errors.Is(err, mutation.ErrNoCatalog) {
			t.Errorf("no registry: %v", err)
		}
	})
}

// tenant.InTx is read-only, so a handler cannot write around the spine: PostgreSQL refuses it.
func TestReadsCannotWrite(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		err := tenant.InTx(ctx, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, "INSERT INTO spine_items (id, household_id, title) VALUES ($1, app_household_id(), 'Milk')", id)
			return err
		})
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "25006" { // read_only_sql_transaction
			t.Errorf("a write through InTx: %v, want read_only_sql_transaction", err)
		}
	})
	if items, _ := w.written(id); items != 0 {
		t.Fatal("a write through InTx was written")
	}
}

// Every update grows the row's version by one and records who made it, and who created the row
// and when stays as it was, whatever the update says.
func TestAnUpdateGrowsTheVersion(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Fatal(err)
		}
	})
	editor := idgen.New()
	w.exec("INSERT INTO users (id) VALUES ($1)", editor)
	w.exec(testsupport.InsertMember, h, editor, "member")
	w.in(h, editor, func(ctx context.Context) {
		_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
			var version int64
			if err := tx.QueryRow(ctx, `
				UPDATE spine_items SET title = 'Oat milk', version = 99, created_by = NULL, created_at = now() - interval '1 year'
				WHERE id = $1 RETURNING version`, id).Scan(&version); err != nil {
				return mutation.Record{}, err
			}
			return mutation.Record{
				Event:   audit.Event{Module: "spine", Action: "item.update", EntityType: "spine.item", EntityID: id, SummaryKey: "spine.item.update"},
				Changes: []sync.Change{{Entity: "spine.item", ID: id, Op: sync.Upsert, Version: version, Row: map[string]any{"id": id}}},
			}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
	})
	var (
		version              int64
		createdBy, updatedBy uuid.UUID
		createdEarlier       bool
	)
	if err := w.admin.QueryRow(t.Context(), `
		SELECT version, created_by, updated_by, created_at < updated_at FROM spine_items WHERE id = $1`, id).
		Scan(&version, &createdBy, &updatedBy, &createdEarlier); err != nil {
		t.Fatal(err)
	}
	if version != 2 || createdBy != u || updatedBy != editor || !createdEarlier {
		t.Fatalf("version %d, created by %s, updated by %s, created before the update %v", version, createdBy, updatedBy, createdEarlier)
	}
}

// entity.Columns names the base columns add_entity_columns adds, in the order Base.Targets
// scans them, so a module's SELECT of them reads each into its own field.
func TestTheBaseColumnsScanIntoBase(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Fatal(err)
		}
	})
	w.exec("UPDATE spine_items SET deleted_at = created_at + interval '1 hour' WHERE id = $1", id)
	var (
		b     entity.Base
		title string
	)
	if err := w.admin.QueryRow(t.Context(), "SELECT "+entity.Columns+", title FROM spine_items WHERE id = $1", id).
		Scan(append(b.Targets(), &title)...); err != nil {
		t.Fatal(err)
	}
	switch {
	case b.ID != id || b.HouseholdID != h || b.Version != 2 || title != "Milk":
		t.Fatalf("id %s household %s version %d title %q", b.ID, b.HouseholdID, b.Version, title)
	case b.CreatedBy == nil || *b.CreatedBy != u || b.UpdatedBy != nil:
		t.Fatalf("created by %v, updated by %v; want %s, and nobody for the administrator's update", b.CreatedBy, b.UpdatedBy, u)
	case !b.Deleted() || !b.DeletedAt.Equal(b.CreatedAt.Add(time.Hour)) || b.UpdatedAt.Before(b.CreatedAt):
		t.Fatalf("created %s, updated %s, deleted %v", b.CreatedAt, b.UpdatedAt, b.DeletedAt)
	}
}

// A request that holds an Idempotency-Key marks it committed in its mutation's own transaction,
// however many mutations it makes, and its response is then what a repeat gets. One whose key a
// repeat took over after the lease cannot commit, and writes nothing.
func TestAMutationCommitsItsIdempotencyKey(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	a, b := idgen.New(), idgen.New()
	twice := func(rw http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		for _, id := range []uuid.UUID{a, b} {
			if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
				t.Error(err)
				rw.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		rw.WriteHeader(http.StatusCreated)
		_, _ = rw.Write([]byte(`{"made":2}`))
	}
	key := http.Header{"Idempotency-Key": {"twice"}}
	if rec := w.serve(h, u, key, twice); rec.Code != http.StatusCreated {
		t.Fatalf("first request: %d %s", rec.Code, rec.Body)
	}
	if rec := w.serve(h, u, key, func(http.ResponseWriter, *http.Request) { t.Error("the repeat ran") }); rec.Code != http.StatusCreated || rec.Body.String() != `{"made":2}` {
		t.Fatalf("repeat: %d %s", rec.Code, rec.Body)
	}

	c := idgen.New()
	lost := func(rw http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		_, err := mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
			rec, err := create(ctx, c, "Milk")(tx)
			// A repeat took the key over while this request ran.
			w.exec("UPDATE idempotency_keys SET claim = $1 WHERE household_id = $2 AND key = 'lost'", idgen.New(), h)
			return rec, err
		})
		if !errors.Is(err, idempotency.ErrClaimLost) {
			t.Errorf("a mutation whose key was taken over: %v, want ErrClaimLost", err)
		}
		problem.Write(rw, "", err)
	}
	// It is answered as a repeat that finds the key held is: another request holds it.
	if rec := w.serve(h, u, http.Header{"Idempotency-Key": {"lost"}}, lost); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), `"code":"idempotency_in_progress"`) {
		t.Fatalf("a request whose key was taken over answered %d %s", rec.Code, rec.Body)
	}
	if items, events := w.written(c); items+events != 0 {
		t.Fatalf("a mutation whose key was taken over left %d items, %d events", items, events)
	}
	if n := w.count("SELECT count(*) FROM idempotency_keys WHERE household_id = $1 AND key = 'lost' AND state = 'in_flight'", h); n != 1 {
		t.Fatal("the request whose key was taken over released it from the request that took it")
	}

	// A request answered other than 2xx after its effect committed keeps its key committed: a
	// repeat is answered 409 and does not run it again.
	d := idgen.New()
	failed := http.Header{"Idempotency-Key": {"failed"}}
	w.serve(h, u, failed, func(rw http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if _, err := mutation.Apply(ctx, create(ctx, d, "Milk")); err != nil {
			t.Error(err)
		}
		rw.WriteHeader(http.StatusInternalServerError)
	})
	if rec := w.serve(h, u, failed, func(http.ResponseWriter, *http.Request) { t.Error("the repeat ran") }); rec.Code != http.StatusConflict {
		t.Fatalf("a repeat of a request answered 500 after its effect: %d %s", rec.Code, rec.Body)
	}
}

// A response larger than the 1 MiB a key keeps is not stored, however it was written: a repeat
// of a request whose effect committed is answered 409 and does not run it again, and one that
// committed nothing finds its key released and runs.
func TestAResponseTooLargeToStoreIsNotReplayed(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	large := bytes.Repeat([]byte("x"), 1<<20+1)
	id := idgen.New()
	effect := http.Header{"Idempotency-Key": {"large-effect"}}
	w.serve(h, u, effect, func(rw http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Error(err)
		}
		rw.WriteHeader(http.StatusCreated)
		_, _ = rw.Write(large)
	})
	if rec := w.serve(h, u, effect, func(http.ResponseWriter, *http.Request) { t.Error("the repeat ran") }); rec.Code != http.StatusConflict {
		t.Fatalf("a repeat of a request whose effect committed and whose response was too large to store: %d", rec.Code)
	}

	// Written in two parts, each small enough to keep, together too large.
	ran := 0
	read := http.Header{"Idempotency-Key": {"large-read"}}
	for range 2 {
		w.serve(h, u, read, func(rw http.ResponseWriter, _ *http.Request) {
			ran++
			_, _ = rw.Write(large[:1<<19])
			_, _ = rw.Write(large[1<<19:])
		})
	}
	if ran != 2 {
		t.Fatalf("a request that committed nothing and whose response was too large to store ran %d times, want 2", ran)
	}
	if n := w.count("SELECT count(*) FROM idempotency_keys WHERE household_id = $1 AND key = 'large-read'", h); n != 0 {
		t.Fatal("the key of a response too large to store was kept")
	}
}

// A response the handler answered by writing nothing, a 200 with the headers it had set when it
// returned, is what a repeat gets, headers included.
func TestAnUnwrittenResponseIsReplayedWithItsHeaders(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	key := http.Header{"Idempotency-Key": {"unwritten"}}
	first := w.serve(h, u, key, func(rw http.ResponseWriter, _ *http.Request) { rw.Header().Set("ETag", `"7"`) })
	again := w.serve(h, u, key, func(http.ResponseWriter, *http.Request) { t.Error("the repeat ran") })
	if first.Code != http.StatusOK || again.Code != http.StatusOK || again.Header().Get("ETag") != `"7"` {
		t.Fatalf("the first answered %d, the repeat %d with ETag %q", first.Code, again.Code, again.Header().Get("ETag"))
	}
}

// An informational response the handler sends ahead of its final one, 103 Early Hints, does not
// stand in for it: the final response is stored, and is what a repeat gets.
func TestAnInformationalResponseIsNotTheOneStored(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	key := http.Header{"Idempotency-Key": {"hinted"}}
	w.serve(h, u, key, func(rw http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Error(err)
		}
		rw.WriteHeader(http.StatusEarlyHints)
		rw.WriteHeader(http.StatusCreated)
		_, _ = rw.Write([]byte(`{"made":1}`))
	})
	again := w.serve(h, u, key, func(http.ResponseWriter, *http.Request) { t.Error("the repeat ran") })
	if again.Code != http.StatusCreated || again.Body.String() != `{"made":1}` {
		t.Fatalf("the repeat of a request answered 103 then 201: %d %s", again.Code, again.Body)
	}
}

// A member removed while their own keyed request is committing: the owner's removal, whose
// membership takes the member's Idempotency-Keys with it, commits, and the member's request finds
// its key gone, rather than the two waiting on each other until PostgreSQL aborts one as a deadlock.
func TestARemovalTakesTheKeyOfARequestCommitting(t *testing.T) {
	w := newWorld(t)
	h, owner := w.member()
	member := idgen.New()
	w.exec("INSERT INTO users (id) VALUES ($1)", member)
	w.exec(testsupport.InsertMember, h, member, "member")

	claimed, removing := make(chan struct{}), make(chan struct{})
	var keyed, removal error
	done := make(chan struct{})
	go func() {
		defer close(done)
		w.serve(h, member, http.Header{"Idempotency-Key": {"mine"}}, func(rw http.ResponseWriter, r *http.Request) {
			close(claimed)
			<-removing
			ctx := r.Context()
			_, keyed = mutation.Apply(ctx, create(ctx, idgen.New(), "Milk"))
			rw.WriteHeader(http.StatusNoContent)
		})
	}()
	select {
	case <-claimed:
	case <-done:
		t.Fatal("the member's keyed request did not reach its handler")
	}
	w.in(h, owner, func(ctx context.Context) {
		id := idgen.New()
		_, removal = mutation.Apply(ctx, func(tx pgx.Tx) (mutation.Record, error) {
			if _, err := tx.Exec(ctx, "DELETE FROM memberships WHERE household_id = app_household_id() AND user_id = $1", member); err != nil {
				return mutation.Record{}, err
			}
			// The member's key is locked now, with their membership. Their request goes on to
			// commit, and waits on it.
			close(removing)
			time.Sleep(300 * time.Millisecond)
			return create(ctx, id, "Removed")(tx)
		})
	})
	select {
	case <-removing:
	default:
		// The removal never reached its mutation: let the member's request go on, so the test
		// fails on what it finds rather than waiting for ever.
		close(removing)
	}
	<-done
	if removal != nil || !errors.Is(keyed, idempotency.ErrClaimLost) {
		t.Fatalf("the removal: %v; the member's keyed request: %v, want ErrClaimLost", removal, keyed)
	}
}

// The feed refuses a row that breaks the shape of a change (PRD 03 §2.2, FR-SY7), whoever
// writes it: here the administrator, directly, as the engine's own retractions will be written.
func TestTheFeedRefusesAMalformedChange(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	type change struct {
		entity, op     string
		version        *int64
		visibility     string
		owner, forUser *uuid.UUID
		payload        *string
	}
	one, row := int64(1), `{"id": "x"}`
	insert := func(c change) error {
		_, err := w.admin.Exec(t.Context(), `
			INSERT INTO sync_changes (household_id, entity_id, entity_type, op, row_version, module, visibility, owner_id, for_user_id, payload)
			VALUES ($1, $2, $3, $4::sync_op, $5, 'spine', $6::sync_visibility, $7, $8, $9::jsonb)`,
			h, idgen.New(), c.entity, c.op, c.version, c.visibility, c.owner, c.forUser, c.payload)
		return err
	}
	if err := insert(change{entity: "spine.item", op: "upsert", version: &one, visibility: "shared", payload: &row}); err != nil {
		t.Fatalf("a well-formed change: %v", err)
	}
	if err := insert(change{entity: "spine.item", op: "retract", visibility: "shared", forUser: &u}); err != nil {
		t.Fatalf("a well-formed retraction: %v", err)
	}
	for name, c := range map[string]change{
		"a retraction to no one":      {entity: "spine.item", op: "retract", visibility: "shared"},
		"a retraction with a row":     {entity: "spine.item", op: "retract", visibility: "shared", forUser: &u, payload: &row},
		"an upsert to one member":     {entity: "spine.item", op: "upsert", version: &one, visibility: "shared", forUser: &u, payload: &row},
		"an upsert with no row":       {entity: "spine.item", op: "upsert", version: &one, visibility: "shared"},
		"a delete with a row":         {entity: "spine.item", op: "delete", version: &one, visibility: "shared", payload: &row},
		"a delete with no version":    {entity: "spine.item", op: "delete", visibility: "shared"},
		"a private row with no owner": {entity: "spine.item", op: "upsert", version: &one, visibility: "private", payload: &row},
		"another module's entity":     {entity: "other.thing", op: "upsert", version: &one, visibility: "shared", payload: &row},
	} {
		t.Run(name, func(t *testing.T) {
			var pgErr *pgconn.PgError
			if err := insert(c); !errors.As(err, &pgErr) || pgErr.Code != "23514" { // check_violation
				t.Fatalf("written: %v, want check_violation", err)
			}
		})
	}
}

// The request role appends to the audit log and the feed and changes nothing in them: a log a
// member could edit is not one (FR-AU5), and a change a replica has applied cannot be taken back.
func TestTheLogAndTheFeedAreAppendOnly(t *testing.T) {
	w := newWorld(t)
	h, u := w.member()
	id := idgen.New()
	w.in(h, u, func(ctx context.Context) {
		if _, err := mutation.Apply(ctx, create(ctx, id, "Milk")); err != nil {
			t.Fatal(err)
		}
	})
	for _, stmt := range []string{
		"UPDATE audit_events SET summary_key = 'x' WHERE entity_id = $1",
		"DELETE FROM audit_events WHERE entity_id = $1",
		"UPDATE audit_changes SET new_value = '1' WHERE event_id IN (SELECT id FROM audit_events WHERE entity_id = $1)",
		"DELETE FROM audit_changes WHERE event_id IN (SELECT id FROM audit_events WHERE entity_id = $1)",
		"UPDATE sync_changes SET payload = '{}' WHERE entity_id = $1",
		"DELETE FROM sync_changes WHERE entity_id = $1",
	} {
		w.in(h, u, func(ctx context.Context) {
			err := tenant.InWriteTx(ctx, func(tx pgx.Tx) error {
				_, err := tx.Exec(ctx, stmt, id)
				return err
			})
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "42501" { // insufficient_privilege
				t.Errorf("%s: %v, want insufficient_privilege", stmt, err)
			}
		})
	}
}
