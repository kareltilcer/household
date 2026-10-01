# Notifications: keys, push services and the scheduler

The notification transport sends Web Push to browsers, Expo pushes to the mobile app, and a small set
of emails, from a queue in PostgreSQL that workers in every instance deliver; the scheduler fires the
platform's nightly and hourly jobs from whichever instance leads
([ADR 0016](../adr/0016-scheduler-and-notification-transports.md)). This runbook says how to make
their settings, how to rotate them, and what to look at when notifications do not arrive.

Every value here but the push hosts and the Expo URL is a secret. Keep them in the environment's
secret store, never in the repository or an image. The server never names a key in its log or its
errors.

## The two keys

| Variable | What it holds | What it protects |
|---|---|---|
| `HOUSEHOLD_NOTIFY_KEYS` | AES-256 keys, 32 bytes each, in base64, comma-separated | The token an invitation's or a graduation's email carries, sealed while the email waits in the queue |
| `HOUSEHOLD_VAPID_KEY` | One P-256 private key, 32 bytes in base64url | The signature on every Web Push the server sends (RFC 8292); its public half is what browsers subscribe with |

Outside development the server does not start without both, nor with the published development
values.

### Make the notify key

```bash
openssl rand -base64 32
```

### Rotate the notify key

1. Make a new value and put it **first**: `HOUSEHOLD_NOTIFY_KEYS=<new>,<old>`. Deploy.
2. Wait until no email sealed under the old key waits: an email that cannot be sent is given up after
   five attempts over about two and a half hours, so a day is ample.
3. Drop the old value. Deploy.

If the old key leaked, its exposure ends as each waiting email is sent; a sealed token is erased from
the queue once its email has gone, and none outlives the link it carries (14 days).

### Make the VAPID key

Any 32 random bytes below the P-256 group order are a key, which all but one in four billion are; the
server refuses one that is not at start, without quoting it. In base64url, unpadded:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

### Rotating the VAPID key

There is one key, not a list: a browser's subscription is bound to the public key it subscribed with,
and a push service refuses a push signed with another. Changing it ends every browser's subscription;
each subscribes again the next time the web app opens and finds its subscription refused. Change it
only if it leaked.

## Push services

A browser's Web Push endpoint must be at a push service the server knows
(`notify.DefaultPushHosts`: Google's, Mozilla's, Apple's and Microsoft's), so that no member can have
the server send to a host of their choosing. A browser whose push service is not among them is refused
`422` when it subscribes; add its host, without a scheme, to `HOUSEHOLD_PUSH_HOSTS`
(comma-separated) and deploy, and say so in an issue so that the list learns it. Every subdomain of a
host named there is sent to, so the server refuses to start with a top-level domain or an address in
it: name the push service's own DNS name.

## Expo

`HOUSEHOLD_EXPO_PUSH_URL` defaults to Expo's service, `https://exp.host/--/api/v2/push`. When the Expo
project requires an access token for push (its *Enhanced push security* setting), set
`HOUSEHOLD_EXPO_ACCESS_TOKEN` to one made in the project's access tokens.

## When notifications do not arrive

The queue and the log are each household's (`notifications`, `notification_deliveries`); query them
as the administrator, never through the API.

```sql
-- What waits, and why: quiet_hours holds until run_at; email_failed and push_unavailable are tried again then.
SELECT id, user_id, message, status, reason, run_at, attempts FROM notifications
WHERE household_id = $1 AND status = 'queued' ORDER BY run_at;

-- What happened to each attempt.
SELECT sent_at, user_id, transport, status, reason FROM notification_deliveries
WHERE household_id = $1 ORDER BY sent_at DESC LIMIT 50;
```

- `no_target`: the member has no browser whose web session lives and no device whose sign-in does, or
  each is stale. A stale browser (`push_subscriptions.stale_at`) or device (`devices.push_stale_at`)
  failed five times in a row; registering it again from the app clears it.
- `gone`: the push service answered `404` or `410`, or Expo `DeviceNotRegistered`; the subscription is
  deleted, or the device's token cleared, and the app registers again when it next opens.
- `push_failed`: the push service refused the push for that target (another `4xx`, or another of
  Expo's errors), which counts towards the five that mark it stale. Expo reports most of Apple's and
  Google's answers only in a ticket's receipt, read every fifteen minutes; a receipt saying Apple or
  Google took a push ends the device's run.
- `push_unavailable`: the push service did not take the push for a reason of its own: no answer, `429`,
  a `5xx`, a browser's push service refusing the server's VAPID signature (`401`, or Apple's `403`
  with the reason `BadJwtToken`), or Expo's `InvalidCredentials`, `MismatchSenderId`, `MessageTooBig`,
  `MessageRateExceeded`, `DeveloperError`, `ExpoError` or `ProviderError`; or the server's own push
  client panicked (`notify: a push panicked`
  in the log). It counts against no target, and a notification no push service took is tried again
  with an email's backoff, five times in all. Many at once are an outage, or the Expo project's
  credentials; check `HOUSEHOLD_EXPO_ACCESS_TOKEN` and the project's push credentials. Many browsers'
  at once, a `401` each, or a `403` each from Safari, are the VAPID signature: the server's clock, or
  `HOUSEHOLD_MAIL_FROM`, its subject.
- `muted`, `category_muted`: the member's own preferences, which win (FR-NT2).
- `no_grant`, `not_member`, `private`: the member may not see what it is about (FR-NT5).
- `replaced`, `withdrawn`: an email that waited for the mail server and no longer says what holds: its
  invitation or graduation link was sent again, or the invitation ended or the link was spent.
- `gave_up`: tried, or claimed by workers that ended before settling it, five times; a push given up
  this way has no transport in the log, since it names no target.
- A notification `queued` with `attempts` at 1 and `run_at` about five minutes after it was claimed is
  held by a worker; one that died lets another take it then.

## The scheduler

`scheduler_jobs` holds each job's next slot and how its last run ended. The leader holds a PostgreSQL
advisory lock; `pg_locks` shows it, `locktype = 'advisory'`, on the leader's connection, which is one
more than its pool's for as long as it leads. That session ends at the server once the leader has not
pinged it for a minute (four ticks, `idle_session_timeout`), so that a leader whose host went releases
the lead then; a leader that finds its connection gone ends the jobs it was running, each logged as
`scheduler: a job failed`, and the next leader runs them again at their retry.

```sql
SELECT name, next_run_at, last_started_at, last_finished_at, last_failed_at FROM scheduler_jobs ORDER BY name;
```

A job whose `last_failed_at` is its last run is tried again within fifteen minutes; its error is in
the log as `scheduler: a job failed`. A job whose `last_finished_at` is older than its
`last_started_at` is running, or its instance ended while it ran, with its process or its host; the
next leader then runs it again fifteen minutes after it started. To run a job sooner, set its
`next_run_at` to `now()`; the leader takes it at its next tick, fifteen seconds at most.
