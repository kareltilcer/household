// Scenarios 3 and 7 of PRD 10 §4 against PowerSync (plan item 5). Throwaway.
//
// Each client is the PowerSync Node SDK over its own SQLite file. Offline is disconnect(): the
// SDK keeps the replica and the upload queue in SQLite and resumes from both on connect(),
// which is what an app restarted without signal does. The connector uploads each queued
// transaction to the spike's backend, which writes through the real mutation spine.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node';
import {
  POWERSYNC,
  canonical,
  checker,
  seed,
  server,
  setEnabled,
  setGrant,
  admin,
  sleep,
  token,
  upload,
  uuidv7,
  waitFor,
} from './common.mjs';

const schema = new Schema({
  shopping_items: new Table({
    household_id: column.text,
    title: column.text,
    checked: column.integer,
    checked_at: column.text,
    version: column.integer,
    deleted_at: column.text,
  }),
  spike_notes: new Table({ household_id: column.text, visibility: column.text, owner_id: column.text, title: column.text, body: column.text, version: column.integer }),
  spike_notes_redacted: new Table({ household_id: column.text, owner_id: column.text, version: column.integer }),
  spike_messages: new Table({ household_id: column.text, conversation_id: column.text, seq: column.integer, body: column.text, version: column.integer }),
});

const dir = mkdtempSync(join(tmpdir(), 'spike-powersync-'));

class Client {
  constructor(name, h, user) {
    Object.assign(this, { name, h, user, applied: [], rejected: [], uploads: 0 });
    this.db = new PowerSyncDatabase({
      schema,
      database: { dbFilename: `${name}-${uuidv7()}.sqlite`, dbLocation: dir },
    });
  }

  connector() {
    return {
      fetchCredentials: async () => ({ endpoint: POWERSYNC, token: await token(this.user) }),
      uploadData: async (db) => {
        for (;;) {
          const tx = await db.getNextCrudTransaction();
          if (!tx) return;
          this.uploads++;
          const results = await upload(this.h, await token(this.user), tx.crud.map(toMutation));
          for (const r of results) (r.result === 'rejected' ? this.rejected : this.applied).push(r);
          // Every outcome is final: an applied one is in the next checkpoint, and a rejected one
          // is surfaced once (above) and dropped, never retried.
          await tx.complete();
        }
      },
    };
  }

  async online() {
    await this.db.connect(this.connector());
  }
  async offline() {
    await this.db.disconnect();
  }
  rows() {
    return this.db.getAll('SELECT * FROM shopping_items ORDER BY title');
  }
  async pending() {
    return (await this.db.getUploadQueueStats()).count;
  }
  async close() {
    await this.db.disconnectAndClear();
    await this.db.close();
  }
}

// toMutation turns a queued PowerSync write into a mutation of PRD 03 §2.4's batch.
function toMutation(e) {
  const op = { PUT: 'create', PATCH: 'update', DELETE: 'delete' }[e.op];
  const fields = {};
  for (const [k, v] of Object.entries(e.opData ?? {})) fields[k] = k === 'checked' ? v === 1 : v;
  return {
    // The spike mints the mutation id at upload; a real connector keeps one per queued write
    // (ps_crud's id with the client's), so that a retried upload is recognised (FR-SY5).
    mutation_id: uuidv7(),
    op,
    entity_id: e.id,
    fields,
    client_time: e.opData?.checked_at ?? new Date().toISOString(),
  };
}

const live = (rows) => rows.filter((r) => !r.deleted_at);

export async function scenario3() {
  const c = checker('PowerSync, scenario 3');
  const h = await seed();
  const petr = new Client('petr', h, h.petr);
  const eva = new Client('eva', h, h.eva);
  try {
    await Promise.all([petr.online(), eva.online()]);
    await waitFor('both replicas hold the list', async () => (await petr.rows()).length === 3 && (await eva.rows()).length === 3);

    await Promise.all([petr.offline(), eva.offline()]);
    const t = Date.now();
    await petr.db.execute('UPDATE shopping_items SET checked = 1, checked_at = ? WHERE id = ?', [new Date(t).toISOString(), h.milk]);
    await eva.db.execute('UPDATE shopping_items SET checked = 1, checked_at = ? WHERE id = ?', [new Date(t + 1000).toISOString(), h.milk]);
    const pm = (await petr.rows()).find((r) => r.id === h.milk);
    const em = (await eva.rows()).find((r) => r.id === h.milk);
    c.ok(pm.checked === 1 && em.checked === 1, 'offline, each replica shows its own check at once');
    c.ok((await petr.pending()) === 1 && (await eva.pending()) === 1, 'each queued one write');

    await Promise.all([petr.online(), eva.online()]);
    const ms = await waitFor('both queues drained and both replicas equal to the server', async () => {
      const s = await server(h);
      return (
        (await petr.pending()) === 0 &&
        (await eva.pending()) === 0 &&
        canonical(await petr.rows()) === canonical(live(s.items)) &&
        canonical(await eva.rows()) === canonical(live(s.items))
      );
    });
    c.ok(true, 'both replicas converge on the server row', `${ms} ms after reconnecting`);

    const s = await server(h);
    const milk = s.items.find((i) => i.id === h.milk);
    c.ok(milk.checked && Number(milk.version) === 2, 'the server holds one check: Milk checked, version 1 to 2', `version ${milk.version}`);
    const events = s.events.filter((e) => e.entity_id === h.milk);
    c.ok(events.length === 1 && events[0].action === 'shopping.item.check', 'one audit event', JSON.stringify(events.map((e) => e.action)));
    c.ok(s.changes.filter((x) => x.entity_id === h.milk).length === 1, 'one change in the feed');
    const outcomes = [...petr.applied, ...eva.applied];
    c.ok(outcomes.length === 2 && outcomes.filter((o) => o.noop).length === 1, 'two applied outcomes, one of them a no-op', JSON.stringify(outcomes.map((o) => (o.noop ? 'applied (noop)' : `applied v${o.version}`))));
    c.ok(petr.rejected.length + eva.rejected.length === 0, 'no rejection and no conflict');
  } finally {
    await petr.close();
    await eva.close();
  }
  return c.results;
}

export async function scenario7() {
  const c = checker('PowerSync, scenario 7');
  const h = await seed();
  const petr = new Client('petr', h, h.petr);
  try {
    await petr.online();
    await waitFor('Petr holds the list', async () => (await petr.rows()).length === 3);

    await petr.offline();
    const butter = uuidv7();
    await petr.db.execute('UPDATE shopping_items SET checked = 1, checked_at = ? WHERE id = ?', [new Date().toISOString(), h.bread]);
    await petr.db.execute('INSERT INTO shopping_items (id, household_id, title, checked) VALUES (?, ?, ?, 0)', [butter, h.household, 'Butter']);
    c.ok((await petr.rows()).length === 4 && (await petr.pending()) === 2, 'offline, Petr checks Bread and adds Butter: 4 rows, 2 queued');

    await setGrant(h, h.petr, 'none');
    await petr.online();
    const ms = await waitFor('the queue drained and the replica emptied', async () => (await petr.pending()) === 0 && (await petr.rows()).length === 0);
    c.ok(true, 'on reconnect the replica holds nothing: every row retracted, the optimistic Butter included', `${ms} ms after reconnecting`);
    c.ok(petr.rejected.length === 2 && petr.rejected.every((r) => r.code === 'not_found'), 'both queued writes rejected, with not_found', JSON.stringify(petr.rejected.map((r) => r.code)));
    const uploads = petr.uploads;
    await sleep(3000);
    c.ok(petr.uploads === uploads && petr.rejected.length === 2, 'the rejections are surfaced once and not retried', `${petr.uploads} uploads, 3 s later`);
    const s = await server(h);
    const bread = s.items.find((i) => i.id === h.bread);
    c.ok(!bread.checked && Number(bread.version) === 1 && !s.items.some((i) => i.id === butter), 'the server is unchanged: Bread unchecked at version 1, no Butter');
    c.ok(s.events.length === 0 && s.changes.length === 0, 'no audit event and no change written');
  } finally {
    await petr.close();
  }
  return c.results;
}

// accessLoss times how long a connected replica takes to follow each cause of access loss
// the spike can make, and back (PRD 03 §2.6).
export async function accessLoss() {
  const c = checker('PowerSync, access loss while connected');
  const h = await seed();
  const petr = new Client('petr', h, h.petr);
  const jana = new Client('jana', h, h.jana);
  try {
    await Promise.all([petr.online(), jana.online()]);
    await waitFor('both hold the list', async () => (await petr.rows()).length === 3 && (await jana.rows()).length === 3);

    await setGrant(h, h.petr, 'none');
    c.ok(true, 'grant lowered to none: rows deleted', `${await waitFor('Petr empty', async () => (await petr.rows()).length === 0)} ms`);
    await setGrant(h, h.petr, 'view');
    c.ok(true, 'grant raised to view: rows back', `${await waitFor('Petr full', async () => (await petr.rows()).length === 3)} ms`);

    await setEnabled(h, false);
    const a = await waitFor('both empty', async () => (await petr.rows()).length === 0 && (await jana.rows()).length === 0);
    c.ok(true, 'module disabled household-wide: rows deleted for a member and for the owner', `${a} ms`);
    await setEnabled(h, true);
    await waitFor('both full', async () => (await petr.rows()).length === 3 && (await jana.rows()).length === 3);

    await admin.query('DELETE FROM memberships WHERE household_id = $1 AND user_id = $2', [h.household, h.petr]);
    c.ok(true, 'removed from the household: rows deleted', `${await waitFor('Petr empty', async () => (await petr.rows()).length === 0)} ms`);

    await admin.query(`UPDATE shopping_items SET deleted_at = now() WHERE id = $1`, [h.eggs]);
    c.ok(true, 'an item soft-deleted: its row leaves the owner\'s replica', `${await waitFor('Jana has 2', async () => (await jana.rows()).length === 2)} ms`);
  } finally {
    await petr.close();
    await jana.close();
  }
  return c.results;
}

// axes probes the two access axes PowerSync cannot state directly (PRD 03 §2.3), through the
// workarounds the spike found: a private row's redacted form in a table of its own, which its
// owner receives as well (D-88); and a conversation's floor (D-90) through the readers the
// server keeps on each message row. Scenarios 16 and 18 of PRD 10 §4.
export async function axes() {
  const c = checker('PowerSync, visibility and audience');
  const h = await seed();
  const note = uuidv7();
  const secret = uuidv7();
  const conversation = uuidv7();
  const [m1, m2, m3] = [uuidv7(), uuidv7(), uuidv7()];
  await admin.query(`INSERT INTO module_enablement (household_id, module, enabled) VALUES ($1, 'spike', true)`, [h.household]);
  await admin.query(
    `INSERT INTO module_grants (household_id, user_id, module, level) VALUES ($1, $2, 'spike', 'contribute'), ($1, $3, 'spike', 'contribute'), ($1, $4, 'spike', 'contribute')`,
    [h.household, h.jana, h.petr, h.eva],
  );
  await admin.query(
    `INSERT INTO spike_notes (id, household_id, visibility, owner_id, title, body) VALUES
       ($1, $3, 'shared', NULL, 'Holiday plan', 'Book the cottage'), ($2, $3, 'private', $4, 'Gift for Jana', 'The blue scarf')`,
    [note, secret, h.household, h.petr],
  );
  await admin.query(
    `INSERT INTO spike_conversation_members (household_id, conversation_id, user_id, floor_seq) VALUES ($1, $2, $3, 0), ($1, $2, $4, 0)`,
    [h.household, conversation, h.jana, h.petr],
  );
  await admin.query(
    `INSERT INTO spike_messages (id, household_id, conversation_id, seq, body, readers) VALUES
       ($1, $3, $4, 1, 'Who buys bread?', ARRAY[$5, $6]::uuid[]), ($2, $3, $4, 2, 'I will', ARRAY[$5, $6]::uuid[])`,
    [m1, m2, h.household, conversation, h.jana, h.petr],
  );
  const petr = new Client('petr', h, h.petr);
  const eva = new Client('eva', h, h.eva);
  const jana = new Client('jana', h, h.jana);
  const q = (cl, sql) => cl.db.getAll(sql);
  const count = async (cl, t) => (await q(cl, `SELECT count(*) AS n FROM ${t}`))[0].n;
  try {
    await Promise.all([petr.online(), eva.online(), jana.online()]);
    await waitFor('the first sync', async () => (await count(petr, 'spike_notes')) === 2 && (await count(eva, 'spike_notes_redacted')) === 1 && (await count(jana, 'spike_messages')) === 2);

    const evaNotes = await q(eva, 'SELECT id, title, body FROM spike_notes');
    const evaRedacted = await q(eva, 'SELECT * FROM spike_notes_redacted');
    c.ok(evaNotes.length === 1 && evaNotes[0].id === note, "Eva holds the shared note whole and not Petr's private one", JSON.stringify(evaNotes.map((n) => n.title)));
    c.ok(evaRedacted.length === 1 && evaRedacted[0].id === secret && !('title' in evaRedacted[0]) && !('body' in evaRedacted[0]), "Eva holds the private note's redacted form: id, owner, version, no title or body", JSON.stringify(Object.keys(evaRedacted[0] ?? {})));
    const petrSecret = await q(petr, `SELECT title FROM spike_notes WHERE id = '${secret}'`);
    c.ok(petrSecret[0]?.title === 'Gift for Jana' && (await count(petr, 'spike_notes_redacted')) === 1, 'Petr holds his private note whole, and its redacted form as well (the workaround)');
    c.ok((await count(eva, 'spike_messages')) === 0 && (await count(petr, 'spike_messages')) === 2, 'the conversation reaches its members only');

    await admin.query(`INSERT INTO spike_conversation_members (household_id, conversation_id, user_id, floor_seq) VALUES ($1, $2, $3, 2)`, [h.household, conversation, h.eva]);
    await admin.query(
      `INSERT INTO spike_messages (id, household_id, conversation_id, seq, body, readers) VALUES ($1, $2, $3, 3, 'Welcome, Eva', ARRAY[$4, $5, $6]::uuid[])`,
      [m3, h.household, conversation, h.jana, h.petr, h.eva],
    );
    await waitFor('Eva receives the message after her floor', async () => (await count(eva, 'spike_messages')) === 1);
    await sleep(1500);
    const evaMsgs = await q(eva, 'SELECT seq FROM spike_messages');
    c.ok(evaMsgs.length === 1 && evaMsgs[0].seq === 3, 'scenario 18: Eva, added with floor 2, receives one message row and nothing before her floor', `rows received: ${evaMsgs.length}`);

    await admin.query(`UPDATE spike_messages SET readers = array_remove(readers, $2::uuid) WHERE conversation_id = $1`, [conversation, h.petr]);
    await admin.query(`DELETE FROM spike_conversation_members WHERE conversation_id = $1 AND user_id = $2`, [conversation, h.petr]);
    const ms = await waitFor('Petr loses the conversation', async () => (await count(petr, 'spike_messages')) === 0);
    c.ok((await count(jana, 'spike_messages')) === 3 && (await count(eva, 'spike_messages')) === 1, 'scenario 16: Petr removed, his messages retracted; the floor still holds for Eva, Jana keeps all three', `${ms} ms; the server rewrote 3 rows to do it`);

    await admin.query(`UPDATE spike_notes SET visibility = 'private', owner_id = $2 WHERE id = $1`, [note, h.jana]);
    const ms2 = await waitFor('the note turns private', async () => (await count(eva, 'spike_notes')) === 0 && (await count(eva, 'spike_notes_redacted')) === 2);
    c.ok(true, "a shared note made private: its full row leaves Eva's replica and its redacted form arrives", `${ms2} ms`);
  } finally {
    await petr.close();
    await eva.close();
    await jana.close();
  }
  return c.results;
}
