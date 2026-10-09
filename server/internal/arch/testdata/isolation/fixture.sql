-- Two households, A and B, each with a row in every tenant table, for the tenant isolation test
-- (FR-NF4). Household A's rows are the ones read; household B's owner is who reads them, and is a
-- member of household A as well, so that household A holds rows of theirs. The PR that adds a
-- tenant table adds its rows here: a tenant table with no row of household A fails the test,
-- since a table the test cannot read from proves nothing. Item 30's seed may take this over.
INSERT INTO users (id, email, email_verified_at) VALUES
  ('01900000-0000-7000-8000-0000000000a1', 'a@example.test', now()),
  ('01900000-0000-7000-8000-0000000000b1', 'b@example.test', now());

INSERT INTO households (id, name, country, timezone, base_currency, locale, units, first_day_of_week, join_code, billing_payer_id) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'A', 'CZ', 'Europe/Prague', 'CZK', 'cs', 'metric', 1, 'AAAAAAAA',
   '01900000-0000-7000-8000-0000000000a1'),
  ('01900000-0000-7000-8000-00000000000b', 'B', 'GB', 'Europe/London', 'GBP', 'en', 'metric', 1, 'BBBBBBBB',
   '01900000-0000-7000-8000-0000000000b1');

INSERT INTO memberships (id, household_id, user_id, role) VALUES
  ('01900000-0000-7000-8000-0000000000f1', '01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'owner'),
  ('01900000-0000-7000-8000-0000000000f2', '01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', 'member'),
  ('01900000-0000-7000-8000-0000000000f3', '01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'owner');

INSERT INTO module_enablement (id, household_id, module, enabled) VALUES
  ('01900000-0000-7000-8000-0000000000f4', '01900000-0000-7000-8000-00000000000a', 'tasks', true),
  ('01900000-0000-7000-8000-0000000000f5', '01900000-0000-7000-8000-00000000000b', 'tasks', true);

-- An invitation in each household, household A's to household B's owner's address: a row the
-- invitation's own policy would show its addressee outside any household's context, and not in
-- household B's.
INSERT INTO invitations (id, household_id, kind, email, role, grants, token_hash, invited_by, expires_at, max_uses) VALUES
  ('01900000-0000-7000-8000-0000000000f6', '01900000-0000-7000-8000-00000000000a', 'email', 'b@example.test', 'member', '{}',
   decode(repeat('a1', 32), 'hex'), '01900000-0000-7000-8000-0000000000a1', now() + interval '14 days', 1),
  ('01900000-0000-7000-8000-0000000000f7', '01900000-0000-7000-8000-00000000000b', 'link', NULL, 'member', '{}',
   decode(repeat('b1', 32), 'hex'), '01900000-0000-7000-8000-0000000000b1', now() + interval '3 days', 1);

INSERT INTO module_grants (household_id, user_id, module, level) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'tasks', 'manage'),
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', 'tasks', 'view'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'tasks', 'manage');

-- An event in each household by household B's owner, who is a member of both, one of them about
-- a private item of theirs.
INSERT INTO audit_events (id, household_id, actor_type, actor_id, module, action, entity_type, entity_id, summary_key, visibility, owner_id) VALUES
  ('01900000-0000-7000-8000-0000000000e1', '01900000-0000-7000-8000-00000000000a', 'user', '01900000-0000-7000-8000-0000000000b1',
   'tasks', 'card.create', 'tasks.card', '01900000-0000-7000-8000-0000000000c1', 'tasks.card.create', 'private', '01900000-0000-7000-8000-0000000000b1'),
  ('01900000-0000-7000-8000-0000000000e2', '01900000-0000-7000-8000-00000000000b', 'user', '01900000-0000-7000-8000-0000000000b1',
   'tasks', 'card.create', 'tasks.card', '01900000-0000-7000-8000-0000000000c2', 'tasks.card.create', 'shared', NULL);

INSERT INTO audit_changes (household_id, event_id, field, old_value, new_value) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000e1', 'title', NULL, '"Milk"'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000e2', 'title', NULL, '"Bread"');

-- A change in each household, and a retraction in household A addressed to household B's owner.
INSERT INTO sync_changes (household_id, entity_type, entity_id, op, row_version, module, visibility, owner_id, for_user_id, payload) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'tasks.card', '01900000-0000-7000-8000-0000000000c1', 'upsert', 1, 'tasks', 'private',
   '01900000-0000-7000-8000-0000000000b1', NULL, '{"title": "Milk"}'),
  ('01900000-0000-7000-8000-00000000000a', 'tasks.card', '01900000-0000-7000-8000-0000000000c1', 'retract', NULL, 'tasks', 'shared',
   NULL, '01900000-0000-7000-8000-0000000000b1', NULL),
  ('01900000-0000-7000-8000-00000000000b', 'tasks.card', '01900000-0000-7000-8000-0000000000c2', 'upsert', 1, 'tasks', 'shared',
   NULL, NULL, '{"title": "Bread"}');

-- Household B's owner holds a key in each household, and household A's owner one in theirs.
INSERT INTO idempotency_keys (household_id, user_id, key, fingerprint, state, claim, claimed_at) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', 'k1', '\x01', 'in_flight', '01900000-0000-7000-8000-0000000000d1', now()),
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', 'k1', '\x02', 'in_flight', '01900000-0000-7000-8000-0000000000d2', now()),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', 'k1', '\x03', 'in_flight', '01900000-0000-7000-8000-0000000000d3', now());

-- Household B's owner's answer to a mutation they pushed in each household, and household A's owner's
-- in theirs.
INSERT INTO sync_mutations (household_id, user_id, mutation_id, fingerprint, outcome, version, row) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-0000000000d4', decode(repeat('a1', 32), 'hex'), 'applied', 1, '{"title": "Milk"}'),
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-0000000000d5', decode(repeat('a2', 32), 'hex'), 'applied', 1, '{"title": "Eggs"}'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-0000000000d6', decode(repeat('b1', 32), 'hex'), 'applied', 1, '{"title": "Bread"}');

-- How many mutations each household's replicas pushed on a day.
INSERT INTO sync_usage (household_id, day, mutations) VALUES
  ('01900000-0000-7000-8000-00000000000a', '2026-09-30', 3),
  ('01900000-0000-7000-8000-00000000000b', '2026-09-30', 1);

-- A replica's last report in each household, household B's owner's in household A among them, with
-- the client that sent it.
INSERT INTO sync_replicas (household_id, id, user_id, label, reported_at, pending_mutations, unresolved, checksum_failures,
  client_type, client_version) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000d7', '01900000-0000-7000-8000-0000000000b1', 'Pixel', now(), 0, 0, 0,
   'mobile', '1.4.2'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000d8', '01900000-0000-7000-8000-0000000000b1', 'Pixel', now(), 0, 0, 0,
   'mobile', '1.4.2');

-- An object in each household, household B's owner's private one in household A, a job for each, and
-- each household's sample of a day, split by module and by member.
INSERT INTO files (household_id, module, entity_id, variant, content_type, byte_size, sha256, filename, owner_id, private, variants) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'documents', '01900000-0000-7000-8000-0000000000c3', 'original', 'application/pdf', 1024,
   decode(repeat('a3', 32), 'hex'), 'Milk.pdf', '01900000-0000-7000-8000-0000000000b1', true, 'pending'),
  ('01900000-0000-7000-8000-00000000000b', 'documents', '01900000-0000-7000-8000-0000000000c4', 'original', 'application/pdf', 2048,
   decode(repeat('b3', 32), 'hex'), 'Bread.pdf', '01900000-0000-7000-8000-0000000000b1', false, 'pending');

INSERT INTO file_jobs (household_id, kind, module, entity_id) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'variants', 'documents', '01900000-0000-7000-8000-0000000000c3'),
  ('01900000-0000-7000-8000-00000000000b', 'variants', 'documents', '01900000-0000-7000-8000-0000000000c4');

INSERT INTO usage_samples (household_id, sampled_on, sampled_at, stored_bytes, derived_bytes, object_count) VALUES
  ('01900000-0000-7000-8000-00000000000a', '2026-09-30', now(), 1024, 0, 1),
  ('01900000-0000-7000-8000-00000000000b', '2026-09-30', now(), 2048, 0, 1);

INSERT INTO usage_sample_modules (household_id, sampled_on, module, stored_bytes, derived_bytes, object_count, row_count) VALUES
  ('01900000-0000-7000-8000-00000000000a', '2026-09-30', 'documents', 1024, 0, 1, 1),
  ('01900000-0000-7000-8000-00000000000b', '2026-09-30', 'documents', 2048, 0, 1, 1);

INSERT INTO usage_sample_members (household_id, sampled_on, user_id, stored_bytes, object_count) VALUES
  ('01900000-0000-7000-8000-00000000000a', '2026-09-30', '01900000-0000-7000-8000-0000000000b1', 1024, 1),
  ('01900000-0000-7000-8000-00000000000b', '2026-09-30', '01900000-0000-7000-8000-0000000000b1', 2048, 1);

-- Household B's owner's notification preferences in each household, a notification to them in each,
-- and its delivery.
INSERT INTO notification_preferences (household_id, user_id, enabled, direct, household, reminders, digest) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000b1', true, true, false, true, true),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000b1', true, true, true, true, true);

INSERT INTO notifications (household_id, id, user_id, category, message, status, settled_at) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000e1', '01900000-0000-7000-8000-0000000000b1',
   'direct', 'notification.access_changed', 'sent', now()),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000e2', '01900000-0000-7000-8000-0000000000b1',
   'direct', 'notification.access_changed', 'sent', now());

INSERT INTO notification_deliveries (household_id, id, notification_id, user_id, category, transport, status, title, body, body_expires_at) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000e3', '01900000-0000-7000-8000-0000000000e1',
   '01900000-0000-7000-8000-0000000000b1', 'direct', 'web_push', 'sent', 'Milk', 'Milk', now()),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000e4', '01900000-0000-7000-8000-0000000000e2',
   '01900000-0000-7000-8000-0000000000b1', 'direct', 'web_push', 'sent', 'Bread', 'Bread', now());

-- What the platform keeps of each household's billing (item 19): household B's owner pays for both,
-- by a subscription in each with an invoice and a month of storage billed, and household A's owner
-- has offered them billing there.
INSERT INTO billing_customers (user_id, currency, stripe_customer_id) VALUES
  ('01900000-0000-7000-8000-0000000000b1', 'EUR', 'cus_isolation_b');

INSERT INTO billing_subscriptions (household_id, stripe_subscription_id, stripe_customer_id, payer_id, standing, status, billing_interval, currency) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'sub_isolation_a', 'cus_isolation_b', '01900000-0000-7000-8000-0000000000b1', 'current', 'active', 'year', 'EUR'),
  ('01900000-0000-7000-8000-00000000000b', 'sub_isolation_b', 'cus_isolation_b', '01900000-0000-7000-8000-0000000000b1', 'current', 'active', 'month', 'EUR');

INSERT INTO billing_invoices (household_id, id, stripe_invoice_id, payer_id, number, status, currency, total_minor, tax_minor, issued_at, period_start, period_end, lines) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000e5', 'in_isolation_a', '01900000-0000-7000-8000-0000000000b1',
   'HH-0001', 'paid', 'EUR', 5988, 0, now(), now(), now() + interval '1 year', '[{"kind": "base", "description": "Milk", "quantity": null, "amount_minor": 5988}]'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000e6', 'in_isolation_b', '01900000-0000-7000-8000-0000000000b1',
   'HH-0002', 'paid', 'EUR', 599, 0, now(), now(), now() + interval '1 month', '[{"kind": "base", "description": "Bread", "quantity": null, "amount_minor": 599}]');

INSERT INTO billing_storage_months (household_id, month, sampled_days, average_bytes, blocks, stripe_invoice_item_id) VALUES
  ('01900000-0000-7000-8000-00000000000a', '2026-09-01', 30, 18000000000, 2, 'ii_isolation_a'),
  ('01900000-0000-7000-8000-00000000000b', '2026-09-01', 30, 4000000000, 0, NULL);

INSERT INTO billing_transfers (household_id, offered_by, offered_to, expires_at) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000a1', '01900000-0000-7000-8000-0000000000b1', now() + interval '14 days');

-- A member who left each household, whose private data waits there for its window to end.
INSERT INTO users (id) VALUES ('01900000-0000-7000-8000-0000000000dd');

INSERT INTO departures (household_id, user_id, cause, departed_at, erase_after) VALUES
  ('01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-0000000000dd', 'left', now(), now() + interval '30 days'),
  ('01900000-0000-7000-8000-00000000000b', '01900000-0000-7000-8000-0000000000dd', 'removed', now(), now() + interval '30 days');

-- What household B's owner's account keeps that names a household (item 20): an export of each,
-- and a diagnostic bundle about each. Global rows, their account's, which go with the household they
-- name all the same: the erasure test holds them to it.
INSERT INTO exports (id, user_id, household_id) VALUES
  ('01900000-0000-7000-8000-0000000000e7', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-00000000000a'),
  ('01900000-0000-7000-8000-0000000000e8', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-00000000000b');

INSERT INTO diagnostic_bundles (id, user_id, household_id, screen, payload, expires_at) VALUES
  ('01900000-0000-7000-8000-0000000000e9', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-00000000000a',
   'sync-health', '{}', now() + interval '30 days'),
  ('01900000-0000-7000-8000-0000000000ea', '01900000-0000-7000-8000-0000000000b1', '01900000-0000-7000-8000-00000000000b',
   'sync-health', '{}', now() + interval '30 days');

-- What the platform staff set for each household (item 21): a flag of its own, and a fair-use
-- ceiling raised.
INSERT INTO platform.feature_flags (key, enabled) VALUES ('isolation.fixture', false);

INSERT INTO household_flags (household_id, key, enabled) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'isolation.fixture', true),
  ('01900000-0000-7000-8000-00000000000b', 'isolation.fixture', true);

INSERT INTO household_limits (household_id, key, value, reason, set_by_label) VALUES
  ('01900000-0000-7000-8000-00000000000a', 'members', 20, 'Three generations under one roof', 'staff@household.example'),
  ('01900000-0000-7000-8000-00000000000b', 'members', 20, 'Three generations under one roof', 'staff@household.example');
