-- Billing (PRD 04 §1, §4, §6; plan item 19, ADR 0020): what the platform keeps of a household's
-- subscription at the payment processor, Stripe. None of it is content, and none of it is a card: a
-- payment method is kept as its summary alone, brand, last four digits and expiry (PRD 04 §6). The
-- household's own state, the six states money decides and the clocks that time them, stays on its
-- row (01020), moved through the mutation spine; what is here is the platform's record of what the
-- processor said, written in the household's context through tenant.InWriteTx and read by its owners
-- (internal/platform/billing).

-- +goose Up

-- A payer's customer at the processor: one per member who pays, in each currency they pay in, since
-- a member may pay for several households and a household's base currency decides what it is charged
-- in (PRD 04 §1). An account's, as its credentials are, and no household's (PRD 01 §2.4).
CREATE TABLE billing_customers (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, currency)
);

-- A household's subscriptions at the processor. standing says what each is to the household: pending
-- while its first payment, or the card of the owner taking billing over, is not confirmed yet;
-- current once it is the household's; ended when it ran out, was cancelled, or another took its
-- place. At most one is pending and one current. status is the processor's own word for it, and the
-- period, the payment method's summary and why it was cancelled are as it last said them: a
-- subscription its payer cancelled leaves the household canceled, and one the processor gave up
-- collecting leaves it in grace (PRD 04 §3).
CREATE TABLE billing_subscriptions (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL,
  stripe_customer_id text NOT NULL,
  payer_id uuid NOT NULL REFERENCES users (id),
  standing text NOT NULL CHECK (standing IN ('pending', 'current', 'ended')),
  status text NOT NULL,
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  payment_method_brand text,
  payment_method_last4 text CHECK (payment_method_last4 ~ '^[0-9]{4}$'),
  payment_method_exp_month smallint CHECK (payment_method_exp_month BETWEEN 1 AND 12),
  payment_method_exp_year smallint,
  cancellation_reason text,
  -- When it became the household's, which a month's storage line is billed from, and when it stopped
  -- being.
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, stripe_subscription_id)
);

CREATE UNIQUE INDEX billing_subscriptions_current ON billing_subscriptions (household_id) WHERE standing = 'current';
CREATE UNIQUE INDEX billing_subscriptions_pending ON billing_subscriptions (household_id) WHERE standing = 'pending';

-- A household's invoices, as the processor issued them: the base fee and the storage blocks as
-- separate lines (PRD 04 §6). An invoice is its payer's, who alone reads it (FR-BI5). attempts counts
-- the failed attempts to collect it its payer was told of, so that each is told once.
CREATE TABLE billing_invoices (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  stripe_invoice_id text NOT NULL,
  payer_id uuid NOT NULL REFERENCES users (id),
  number text,
  status text NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  issued_at timestamptz NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  lines jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, stripe_invoice_id)
);

CREATE INDEX billing_invoices_issued ON billing_invoices (household_id, payer_id, issued_at DESC, id DESC);

-- A calendar month's storage line (PRD 04 §4, D-31): the mean of the month's daily samples, the
-- whole blocks it comes to, and the invoice item that bills them, none for a month that needs none.
-- A month is UTC's, as the samples it averages are (D-109). The row is written in the transaction
-- that asks the processor for the line, which answers the line it added when it is asked again, so
-- that a month is billed once.
CREATE TABLE billing_storage_months (
  household_id uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  sampled_days integer NOT NULL CHECK (sampled_days >= 0),
  average_bytes bigint NOT NULL CHECK (average_bytes >= 0),
  blocks integer NOT NULL CHECK (blocks >= 0),
  stripe_invoice_item_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, month)
);

-- The payer's offer of billing to another owner (FR-BI6), one at a time, for 14 days: it goes with
-- either membership, and the subscription is untouched until the other owner accepts and their card
-- is confirmed.
CREATE TABLE billing_transfers (
  household_id uuid PRIMARY KEY REFERENCES households (id) ON DELETE CASCADE,
  offered_by uuid NOT NULL,
  offered_to uuid NOT NULL CHECK (offered_to <> offered_by),
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (household_id, offered_by) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, offered_to) REFERENCES memberships (household_id, user_id) ON DELETE CASCADE
);

SELECT enable_tenant_isolation('billing_subscriptions');
SELECT enable_tenant_isolation('billing_invoices');
SELECT enable_tenant_isolation('billing_storage_months');
SELECT enable_tenant_isolation('billing_transfers');
