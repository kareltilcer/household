// What both candidates' scenarios share (plan item 5). Throwaway.
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

export const BACKEND = process.env.SPIKE_BACKEND ?? 'http://127.0.0.1:8091';
export const POWERSYNC = process.env.SPIKE_POWERSYNC ?? 'http://127.0.0.1:8090';
export { uuidv7 };

// The administrator: seeds, reads the server's truth, and stands in for item 10's grant
// change, which a real owner makes through the API.
export const admin = new pg.Pool({
  connectionString:
    process.env.SPIKE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5442/household',
  max: 4,
});

// seed makes a fresh household for one scenario: Jana owns it, Petr and Eva contribute to
// Shopping, and three items are on the list.
export async function seed() {
  const h = {
    household: uuidv7(),
    jana: uuidv7(),
    petr: uuidv7(),
    eva: uuidv7(),
    milk: uuidv7(),
    bread: uuidv7(),
    eggs: uuidv7(),
  };
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO users (id) VALUES ($1), ($2), ($3)', [h.jana, h.petr, h.eva]);
    await c.query('INSERT INTO households (id) VALUES ($1)', [h.household]);
    await c.query(
      `INSERT INTO memberships (household_id, user_id, role) VALUES
         ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')`,
      [h.household, h.jana, h.petr, h.eva],
    );
    await c.query(
      `INSERT INTO module_enablement (household_id, module, enabled) VALUES ($1, 'shopping', true)`,
      [h.household],
    );
    await c.query(
      `INSERT INTO module_grants (household_id, user_id, module, level) VALUES
         ($1, $2, 'shopping', 'contribute'), ($1, $3, 'shopping', 'contribute')`,
      [h.household, h.petr, h.eva],
    );
    await c.query(
      `INSERT INTO shopping_items (id, household_id, title) VALUES
         ($1, $4, 'Milk'), ($2, $4, 'Bread'), ($3, $4, 'Eggs')`,
      [h.milk, h.bread, h.eggs, h.household],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  return h;
}

export async function setGrant(h, user, level) {
  await admin.query(
    `UPDATE module_grants SET level = $3 WHERE household_id = $1 AND user_id = $2 AND module = 'shopping'`,
    [h.household, user, level],
  );
}

export async function setEnabled(h, enabled) {
  await admin.query(
    `UPDATE module_enablement SET enabled = $2 WHERE household_id = $1 AND module = 'shopping'`,
    [h.household, enabled],
  );
}

// server is the household's truth: its items, and what the spine recorded for them.
export async function server(h) {
  const items = (
    await admin.query(
      `SELECT id, title, checked, version, deleted_at FROM shopping_items
       WHERE household_id = $1 ORDER BY title`,
      [h.household],
    )
  ).rows;
  const events = (
    await admin.query(
      `SELECT module || '.' || action AS action, entity_id FROM audit_events
       WHERE household_id = $1 ORDER BY occurred_at`,
      [h.household],
    )
  ).rows;
  const changes = (
    await admin.query(
      `SELECT entity_id, op::text, row_version FROM sync_changes WHERE household_id = $1 ORDER BY seq`,
      [h.household],
    )
  ).rows;
  return { items, events, changes };
}

export async function token(user) {
  const res = await fetch(`${BACKEND}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: user }),
  });
  if (!res.ok) throw new Error(`token: ${res.status}`);
  return (await res.json()).token;
}

// upload pushes a batch to the backend and returns its per-mutation outcomes.
export async function upload(h, tok, mutations, fetchFn = fetch) {
  const res = await fetchFn(`${BACKEND}/households/${h.household}/shopping/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ mutations }),
  });
  if (res.status === 404) {
    // The household is gone for this caller: every mutation is rejected alike.
    return mutations.map((m) => ({ mutation_id: m.mutation_id, result: 'rejected', code: 'not_found' }));
  }
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`);
  return (await res.json()).results;
}

export async function waitFor(label, pred, timeoutMs = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await pred();
    if (last) return Date.now() - start;
    await sleep(100);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// check records one assertion of a scenario.
export function checker(name) {
  const results = [];
  return {
    results,
    ok(cond, what, detail) {
      results.push({ scenario: name, ok: !!cond, what, detail: detail ?? '' });
      console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}: ${what}${detail ? `  (${detail})` : ''}`);
    },
    note(what) {
      results.push({ scenario: name, ok: null, what, detail: '' });
      console.log(`NOTE  ${name}: ${what}`);
    },
  };
}

// canonical is a replica's rows in a comparable form.
export function canonical(rows) {
  return JSON.stringify(
    rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        checked: r.checked === true || r.checked === 1,
        version: Number(r.version),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
