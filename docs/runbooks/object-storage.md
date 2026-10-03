# Object storage and the converter

Households' files, users' pictures and the archives of their exports live in one private bucket of an
S3-compatible store; the API writes them, once each, and hands out links pre-signed for one object
for fifteen minutes at most ([ADR 0015](../adr/0015-files-object-storage-the-meter-and-pictures.md),
[ADR 0020](../adr/0020-export-erasure-and-the-tombstones.md), PRD 01 §8). The converter sidecar
derives an office document's PDF and a PDF's first page. Read this before an environment's first
deploy, when uploads fail with `502 storage_unavailable`, when previews stop appearing, when an
export fails or an erasure's objects stay, and when the sweep or a household's storage figures look
wrong.

## What is where

| | |
|---|---|
| The bucket | `HOUSEHOLD_OBJECT_STORE_URL`'s path: `http(s)://ACCESS_KEY:SECRET@host:port/bucket?region=…`. `household` on the compose RustFS in development, which the server makes when it starts; a deployment's is provisioned, never made by the server |
| A household's files | `h/{household_id}/{module}/{entity_id}/{variant}`: `original` as uploaded, `thumbnail`, `preview` and `pdf` derived. Their rows are `files`, in the household |
| Users' pictures | `u/{user_id}/avatar/{id}/picture`. Their rows are `avatars`, global. Metered to no household (D-107) |
| Exports' archives | `u/{user_id}/exports/{export_id}/{claim}`, one per try of an export, under its requester's prefix whether it is their own export or a household's. Their rows are `exports`, global: a `ready` row names its archive in `object`, for seven days. Metered to no household (D-133). Every API instance runs the worker that builds them, sent in 32 MiB parts as a multipart upload |
| What erasure leaves | `erasures`, global: a row per erased household or account, with `purged_at` once the objects under `h/{household_id}/` or `u/{user_id}/` were removed. The nightly job (`privacy.erase`, 02:30 UTC) removes them when it erases, and again each night for three days |
| Work after a commit | `file_jobs`: `variants` for an original's variants, `purge` for a deleted entity's bytes. Every API instance runs the workers |
| The converter | `HOUSEHOLD_CONVERTER_URL`, the image `deploy/converter` builds; `pnpm run up:convert` in development |
| The samples | `usage_samples`, `usage_sample_modules`, `usage_sample_members`, one set per household per UTC day |
| The meter role | `household_meter`, `HOUSEHOLD_METER_DATABASE_URL`, which `serve` now reads: it lists the households with work due, measures them for the sample, and counts a household's objects and rows live for fair use (`storage.Count`, item 16's) |

## Before the first deploy

1. **Provision the bucket** in the EU region the environment runs in (PL-8), private, with no public
   access policy of any kind: every read is a pre-signed link.
2. **Turn versioning on**, with a lifecycle rule that expires noncurrent versions and delete markers
   after 35 days, the backups' retention (PRD 07 §3). A purge or a sweep then removes an object at
   once for everyone, and the store keeps its previous version for the backups' window only. **Add a
   rule that aborts incomplete multipart uploads after a day**: an export's archive is sent in parts,
   the API aborts an upload that fails, and one whose process died in the middle leaves parts no
   listing shows and no sweep removes. A try lasts six hours at most, so a day aborts none still
   running.
3. **Replicate it** to a second account in the EU (PRD 01 §8).
4. **Give the API a key of its own**, allowed `GetObject`, `PutObject` (conditional writes and
   multipart uploads included), `AbortMultipartUpload`, `DeleteObject`, `ListBucket` and `HeadBucket`
   on this bucket and nothing else. Without `AbortMultipartUpload` an export still builds, and the
   parts of one that failed stay until the lifecycle rule takes them. The URL carrying it is a
   secret, like the database's; outside development the server refuses the compose store's published
   one and plain http.
5. **Put an edge in front of the bucket that adds `X-Content-Type-Options: nosniff`** to every
   response (FR-FL2). The store cannot: a pre-signed URL sets the response's type and disposition, and
   no other header. Name the edge's scheme and host in `HOUSEHOLD_OBJECT_STORE_PUBLIC_URL` when
   clients reach the bucket there rather than where the API does; the links are signed for the host
   they name.
6. **Run the converter beside the API with no route out**: a document may name remote resources,
   which LibreOffice would fetch. It needs no volume and no secret; give it two CPUs per concurrent
   conversion (`HOUSEHOLD_CONVERTER_JOBS`, 2) and a gigabyte of memory each.
7. Give the API a disk for `HOUSEHOLD_UPLOAD_DIR` large enough for its concurrent uploads at 100 MB
   each; the server clears what a process that died left there when it starts.

## Uploads fail with `502 storage_unavailable`

The API could not write to the store, and committed nothing: the client sends the upload again. Reads
of what is already stored, and their links, still work (FR-NF3). Each instance's `/readyz` answers
`degraded`, still `200`, with `object_store: down` while it cannot reach the bucket, and a store that
stops answering fails a request once each of the client's three attempts has waited a minute for an
answer to begin, about three minutes in all.

1. Look for `files: the object store refused an upload` or `avatar: the object store refused a
   picture` in the API's log, with the error.
2. From an API instance, check the store answers and the bucket is there: `HEAD` the bucket with the
   API's key. A `403` is the key or its policy; a `404` is the bucket's name or region; a timeout is
   the network.
3. A `412` is not an outage: it is the store refusing to overwrite a key, which the API answers
   itself, and nor is a `409` `ConditionalRequestConflict`, a write that raced another to its key,
   which the API answers once it knows which of the two landed. If the store answers every conditional write with `501`, it does not support `If-None-Match`
   on `PutObject`, and uploads cannot be write-once there: change stores rather than drop the
   condition.

## Previews stop appearing

A file whose variants could not be derived stays download-only; its upload is never lost (FR-FL3).

```sql
-- As the database's administrator: the jobs waiting, and those retried.
SELECT kind, module, count(*), max(attempts), min(run_at)
FROM file_jobs GROUP BY kind, module;

-- The originals uploaded in the last day whose variants failed: a file records when it was uploaded,
-- not when its job gave up, which may be hours later.
SELECT module, content_type, count(*)
FROM files WHERE variant = 'original' AND variants = 'failed' AND created_at > now() - interval '1 day'
GROUP BY module, content_type;
```

- Jobs piling up with `run_at` in the past: no worker is running them. Every instance runs them; check
  the API's log for `files: find the jobs due`, which fails when the meter role's connection does.
- `attempts` climbing for office documents and PDFs: the converter. `GET /healthz` on it; its log names
  each conversion that failed or ran out of time, by its command and how it ended, never by what the
  command printed, which quotes the document. A job gives up after five attempts, over about two and a
  half hours; one that runs past its ten-minute lease, a store or a converter that stopped answering,
  counts as a failed attempt. A job that panicked fails at once, logged as `files: a job panicked`
  with the panic's type and stack; one whose workers ended with their process five times, killed for
  the memory it took, is given up at its next claim. Either is a bug to report with the file's type.
- Many `failed` of one type: a converter that cannot read it answers `422`, which is not retried. A
  converter that could not start its command answers `500`, and one whose command the system killed
  for its memory `503`, both of which are retried; its log names each (`conversion failed`, `a
  conversion was killed`). Try one by hand:
  `curl --data-binary @file.docx 'http://converter:3100/pdf?ext=docx' -o out.pdf`.

To derive a failed file's variants again, once the cause is fixed, put its job back:

```sql
-- As the migrate role, in the household's context.
SELECT set_config('app.household_id', '<household>', false);
UPDATE files SET variants = 'pending'
WHERE household_id = '<household>' AND module = '<module>' AND entity_id = '<entity>' AND variant = 'original';
INSERT INTO file_jobs (household_id, kind, module, entity_id) VALUES ('<household>', 'variants', '<module>', '<entity>');
```

## An export fails, or an erasure's objects stay

An export is tried three times, five minutes apart, and has then failed, with nothing of its archive
kept; its requester asks again (five of a kind a day). One whose process stopped goes back to the
queue uncounted, and one whose worker died is taken again once its six-hour lease has passed.

```sql
-- As the database's administrator: the exports waiting or running, and those that failed in the last day.
SELECT status, count(*), max(attempts), min(run_at) FROM exports WHERE status IN ('queued', 'running') GROUP BY status;
SELECT id, user_id, household_id, attempts, ended_at FROM exports WHERE status = 'failed' AND ended_at > now() - interval '1 day';

-- The erasures whose objects are not known to be gone.
SELECT kind, id, cause, erased_at FROM erasures WHERE purged_at IS NULL;
```

- `privacy: an export failed` in the API's log carries the error of each try: the store's, when it
  refused the upload, in which case uploads fail too (above); `privacy: an export panicked` is a bug
  in a module's part of it, to report with the panic's type and stack, and that export is not tried
  again.
- Exports `queued` with `run_at` in the past: no worker is running them. Every instance runs one, and
  logs `privacy: claim an export` when it cannot reach the database.
- An archive the store keeps under `u/{user_id}/exports/` that no `ready` row names is removed by the
  expiry sweep once it is a day old (`expiry.sweep`, 03:00 UTC), as is a `ready` export's seven days
  after it was ready.
- An erasure with `purged_at` null: the rows are gone and the store refused the listing or a delete,
  which the job logs with the error, as `privacy: an erasure failed` the night it erased and as
  `privacy: remove an erasure's objects` on the nights after. It tries each again every night until
  it succeeds; nothing else names those objects, so do not delete the row.

## Storage figures look wrong

The storage picture's totals are live, from `files`; billing and the trend read the samples. Bytes no
row records are billed to nobody and are swept once a day old, so the bucket may briefly hold more
than the samples say.

- Compare a household's rows with its prefix: `SELECT sum(byte_size), count(*) FROM files WHERE
  household_id = …` against a listing of `h/{household_id}/`. More objects than rows is what the
  sweep removes; more rows than objects is a missing object, which a link answers `404` from the
  store: find the upload's request in the log, and restore the object from the store's versions.
- A household with no sample for a day: the sampler logs `storage: write a usage sample` with the
  error for each household it could not write, and samples the rest.
