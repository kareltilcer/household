# Runbooks

Step-by-step procedures for operating Household: restoring a backup, rotating a secret,
answering a data-subject request, handling an incident. One file per procedure, written for
someone who is doing it for the first time, under pressure.

| Runbook | When |
|---|---|
| [Building and refreshing the breached-password corpus](breached-passwords.md) | Before an environment's first deploy, and every three months |
| [Sign-in keys, identity providers and the oldest client served](sign-in-keys-and-providers.md) | Before an environment's first deploy, when a key is rotated or leaks, when a provider is added, and when a release retires an old client |
| [PowerSync's replication slot](replication-slot.md) | When replication lags, when write-ahead log fills the disk, and after a restore or a failover |
| [PowerSync's compaction](compaction.md) | When bucket storage keeps growing, when the nightly compaction failed, and after an erasure that must leave bucket storage the same night |
| [Object storage and the converter](object-storage.md) | Before an environment's first deploy, when uploads fail with `502`, when previews stop appearing, and when storage figures look wrong |
| [Notifications: keys, push services and the scheduler](notifications.md) | Before an environment's first deploy, when a notification key is rotated or leaks, when a browser's push service is refused, when notifications do not arrive, and when a nightly job did not run |
| [Billing: Stripe's account, keys, prices and webhook](billing.md) | Before an environment's first deploy, when a price changes or a currency is added, when a Stripe key is rotated or leaks, when a payment went through and the household is not `active`, and when a month's storage was not billed |

The gate G-C acceptance protocol, `gate-g-c.md`, follows with plan item 34. Incident response,
breach notification, restore and failover follow with the resilience drills (item 89), and secret
rotation with security hardening (item 91).
