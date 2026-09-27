// Scenarios 3 and 7 of PRD 10 §4 against Electric (plan item 5). Throwaway.
//
// Electric replicates reads only, so each client here is Electric's own ShapeStream and Shape,
// reached through the spike backend's proxy, plus what Electric leaves to us: an outbox of
// mutations, the optimistic view of them over the synced rows, and their upload to the same
// backend PowerSync's connector calls. Offline is the network failing, every request refused
// and any response in flight lost, while the stream backs off and keeps its offset.
//
// The proxy has two variants. gate checks the grant in the backend and answers 404 without
// it; Electric knows nothing of grants, and the client clears its rows on the 404 by a
// convention of ours. subquery puts the grant in the shape's where clause as subqueries, so
// that Electric itself moves rows out when the grant goes.
import { FetchError, Shape, ShapeStream } from '@electric-sql/client';
import { BACKEND, canonical, checker, seed, server, setEnabled, setGrant, admin, sleep, token, upload, uuidv7, waitFor } from './common.mjs';

class Net {
  offline = false;
  fetch = async (input, init) => {
    if (this.offline) throw new TypeError('fetch failed: offline');
    const res = await fetch(input, init);
    if (this.offline) throw new TypeError('fetch failed: offline, response lost');
    return res;
  };
}

// TaggedStore is a replica that applies Electric's whole protocol, move-outs included, which
// the client's own Shape (1.5.28) does not: it applies inserts, updates, deletes and
// must-refetch, and ignores move-out and move-in events, so a row whose subquery stops matching
// stays on the client. Each row carries one tag per OR branch of the where clause, a
// '/'-separated position per condition, and the conditions' current truth
// (active_conditions); a move-out names the positions whose value no longer matches, and a row
// leaves when no branch has all of its conditions true.
class TaggedStore {
  rows = new Map();
  apply(m) {
    const hd = m.headers ?? {};
    if (hd.operation === 'insert' || hd.operation === 'update') {
      const prev = this.rows.get(m.key);
      this.rows.set(m.key, {
        value: { ...(prev?.value ?? {}), ...m.value },
        tags: hd.tags ?? prev?.tags ?? [],
        active: [...(hd.active_conditions ?? prev?.active ?? [])],
      });
    } else if (hd.operation === 'delete') {
      this.rows.delete(m.key);
    } else if (hd.control === 'must-refetch') {
      this.rows.clear();
    } else if (hd.event === 'move-out' || hd.event === 'move-in') {
      for (const [key, row] of this.rows) {
        for (const tag of row.tags) {
          const parts = tag.split('/');
          for (const p of hd.patterns) if (parts[p.pos] === p.value) row.active[p.pos] = hd.event === 'move-in';
        }
        const inShape = row.tags.some((tag) => tag.split('/').every((part, pos) => part === '' || row.active[pos]));
        if (!inShape) this.rows.delete(key);
      }
    }
  }
  get currentRows() {
    return [...this.rows.values()].map((r) => r.value);
  }
}

class Client {
  constructor(name, h, user, variant, replica = 'shape') {
    Object.assign(this, { name, h, user, variant, replica, outbox: [], applied: [], rejected: [], messages: [], refused: null });
    this.net = new Net();
    this.abort = new AbortController();
  }

  async start() {
    const tok = await token(this.user);
    this.stream = new ShapeStream({
      url: `${BACKEND}/households/${this.h.household}/shopping/shape`,
      params: { variant: this.variant },
      headers: { authorization: `Bearer ${tok}` },
      fetchClient: this.net.fetch,
      signal: this.abort.signal,
      backoffOptions: { initialDelay: 50, maxDelay: 250, multiplier: 1.3 },
      onError: (err) => {
        if (err instanceof FetchError && (err.status === 404 || err.status === 403)) {
          // Our convention, not Electric's: the proxy refused the shape, so the caller has lost
          // it, and the client deletes what it holds of it.
          this.refused = err.status;
          return;
        }
        return {};
      },
    });
    this.tagged = new TaggedStore();
    this.stream.subscribe((msgs) => {
      for (const m of msgs) {
        this.tagged.apply(m);
        if (m.headers?.event) this.messages.push(`event:${m.headers.event}`);
        else if (m.headers?.control) this.messages.push(`control:${m.headers.control}`);
        else if (m.headers?.operation) this.messages.push(`${m.headers.operation}`);
      }
    });
    this.shape = new Shape(this.stream);
    await this.shape.rows;
  }

  // rows is what the member sees: the synced rows, with the outbox applied over them.
  rows() {
    const synced = this.replica === 'tags' ? this.tagged.currentRows : this.shape.currentRows;
    const byId = new Map((this.refused ? [] : synced).map((r) => [r.id, { ...r }]));
    for (const m of this.outbox) {
      if (m.op === 'create') byId.set(m.entity_id, { id: m.entity_id, version: 0, checked: false, ...m.fields });
      else if (m.op === 'update' && byId.has(m.entity_id)) Object.assign(byId.get(m.entity_id), m.fields);
      else if (m.op === 'delete') byId.delete(m.entity_id);
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  async write(op, entityId, fields) {
    this.outbox.push({ mutation_id: uuidv7(), op, entity_id: entityId, fields, client_time: new Date().toISOString() });
    if (!this.net.offline) await this.flush();
  }

  // flush uploads the outbox in one batch. Every outcome is final: an applied mutation leaves
  // the outbox, its row arriving through the shape; a rejected one is surfaced once and dropped.
  async flush() {
    if (!this.outbox.length) return;
    const batch = this.outbox.slice();
    const results = await upload(this.h, await token(this.user), batch, this.net.fetch);
    for (const r of results) {
      this.outbox = this.outbox.filter((m) => m.mutation_id !== r.mutation_id);
      (r.result === 'rejected' ? this.rejected : this.applied).push(r);
    }
  }

  offline() {
    this.net.offline = true;
  }
  async online() {
    this.net.offline = false;
    await this.flush();
  }
  stop() {
    this.abort.abort();
  }
}

export async function scenario3(variant) {
  const c = checker(`Electric (${variant}), scenario 3`);
  const h = await seed();
  const petr = new Client('petr', h, h.petr, variant);
  const eva = new Client('eva', h, h.eva, variant);
  try {
    await Promise.all([petr.start(), eva.start()]);
    await waitFor('both hold the list', async () => petr.rows().length === 3 && eva.rows().length === 3);

    petr.offline();
    eva.offline();
    const t = Date.now();
    await petr.write('update', h.milk, { checked: true, checked_at: new Date(t).toISOString() });
    await eva.write('update', h.milk, { checked: true, checked_at: new Date(t + 1000).toISOString() });
    petr.outbox[0].client_time = new Date(t).toISOString();
    eva.outbox[0].client_time = new Date(t + 1000).toISOString();
    c.ok(petr.rows().find((r) => r.id === h.milk).checked && eva.rows().find((r) => r.id === h.milk).checked, 'offline, each shows its own check at once (our outbox, over the shape)');

    await Promise.all([petr.online(), eva.online()]);
    const ms = await waitFor('both converge on the server', async () => {
      const live = (await server(h)).items.filter((i) => !i.deleted_at);
      return !petr.outbox.length && !eva.outbox.length && canonical(petr.rows()) === canonical(live) && canonical(eva.rows()) === canonical(live);
    });
    c.ok(true, 'both replicas converge on the server row', `${ms} ms after reconnecting`);
    const s = await server(h);
    const milk = s.items.find((i) => i.id === h.milk);
    c.ok(milk.checked && Number(milk.version) === 2, 'the server holds one check: Milk checked, version 1 to 2', `version ${milk.version}`);
    c.ok(s.events.filter((e) => e.entity_id === h.milk).length === 1, 'one audit event');
    c.ok(s.changes.filter((x) => x.entity_id === h.milk).length === 1, 'one change in the feed');
    const outcomes = [...petr.applied, ...eva.applied];
    c.ok(outcomes.length === 2 && outcomes.filter((o) => o.noop).length === 1, 'two applied outcomes, one a no-op', JSON.stringify(outcomes.map((o) => (o.noop ? 'applied (noop)' : `applied v${o.version}`))));
    c.ok(!petr.rejected.length && !eva.rejected.length, 'no rejection and no conflict');
  } finally {
    petr.stop();
    eva.stop();
  }
  return c.results;
}

export async function scenario7(variant, replica = 'shape') {
  const c = checker(`Electric (${variant}, ${replica === 'tags' ? 'tag-aware replica' : 'official Shape'}), scenario 7`);
  const h = await seed();
  const petr = new Client('petr', h, h.petr, variant, replica);
  try {
    await petr.start();
    await waitFor('Petr holds the list', async () => petr.rows().length === 3);

    petr.offline();
    await sleep(300);
    const butter = uuidv7();
    await petr.write('update', h.bread, { checked: true, checked_at: new Date().toISOString() });
    await petr.write('create', butter, { title: 'Butter', household_id: h.household });
    c.ok(petr.rows().length === 4 && petr.outbox.length === 2, 'offline, Petr checks Bread and adds Butter: 4 rows, 2 queued');

    await setGrant(h, h.petr, 'none');
    await sleep(500);
    const before = petr.messages.length;
    await petr.online();
    c.ok(petr.rejected.length === 2 && petr.rejected.every((r) => r.code === 'not_found'), 'both queued writes rejected, with not_found', JSON.stringify(petr.rejected.map((r) => r.code)));
    let ms;
    try {
      ms = await waitFor('the replica emptied', async () => petr.rows().length === 0, 15000);
      c.ok(true, 'on reconnect the replica holds nothing', `${ms} ms after reconnecting; ${petr.refused ? `the proxy answered ${petr.refused} and our client cleared its rows` : 'Electric removed the rows'}`);
    } catch {
      c.ok(false, 'on reconnect the replica holds nothing', `still holds ${petr.rows().length}: ${petr.rows().map((r) => r.title).join(', ')}`);
    }
    c.note(`messages after reconnecting: ${JSON.stringify(petr.messages.slice(before))}`);
    const s = await server(h);
    const bread = s.items.find((i) => i.id === h.bread);
    c.ok(!bread.checked && Number(bread.version) === 1 && !s.items.some((i) => i.id === butter), 'the server is unchanged: Bread unchecked at version 1, no Butter');
    c.ok(s.events.length === 0 && s.changes.length === 0, 'no audit event and no change written');
  } finally {
    petr.stop();
  }
  return c.results;
}

export async function accessLoss(variant, replica = 'shape') {
  const c = checker(`Electric (${variant}, ${replica === 'tags' ? 'tag-aware replica' : 'official Shape'}), access loss while connected`);
  const h = await seed();
  const petr = new Client('petr', h, h.petr, variant, replica);
  const jana = new Client('jana', h, h.jana, variant, replica);
  const attempt = async (what, pred) => {
    const before = petr.messages.length + jana.messages.length;
    try {
      c.ok(true, what, `${await waitFor(what, pred, 10000)} ms`);
    } catch {
      c.ok(false, what, `not within 10 s; Petr holds ${petr.rows().length}, Jana ${jana.rows().length}`);
    }
    c.note(`messages: ${JSON.stringify([...petr.messages, ...jana.messages].slice(before))}`);
  };
  try {
    await Promise.all([petr.start(), jana.start()]);
    await waitFor('both hold the list', async () => petr.rows().length === 3 && jana.rows().length === 3);
    await setGrant(h, h.petr, 'none');
    await attempt('grant lowered to none: rows deleted', async () => petr.rows().length === 0);
    if (!petr.refused) {
      await setGrant(h, h.petr, 'view');
      await attempt('grant raised to view: rows back', async () => petr.rows().length === 3);
      await setEnabled(h, false);
      await attempt('module disabled household-wide: rows deleted for a member and the owner', async () => petr.rows().length === 0 && jana.rows().length === 0);
    }
  } finally {
    petr.stop();
    jana.stop();
  }
  return c.results;
}
