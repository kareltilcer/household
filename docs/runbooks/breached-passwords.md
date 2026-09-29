# Building and refreshing the breached-password corpus

The server refuses a new password that appears in a public breach (FR-ID1, D-12). It checks against
a file on its own disk, `HOUSEHOLD_BREACH_CORPUS`, and never asks anyone else: no password,
hashed or prefixed, leaves the platform. The file is built from Have I Been Pwned's *Pwned
Passwords* by Troy Hunt, licensed CC BY 4.0, and holds the first 8 bytes of each password's SHA-1,
sorted ([ADR 0009](../adr/0009-accounts-sessions-throttles-and-the-breach-corpus.md)).

Outside development the server does not start without the file. In development it starts, logs
`breached-password screening is off: no corpus configured`, and accepts any password of twelve
characters or more.

## When

- Before the first deploy of an environment that is not development.
- Every three months, since the corpus grows as breaches are added, and after a breach large
  enough to make the news.

## Build it

It needs Go, the repository, about 10 GB free, and an hour or two of network time. From `server/`:

```bash
go run ./cmd/breach-dataset -out /tmp/breached.bin
```

It downloads all 1 048 576 ranges of `https://api.pwnedpasswords.com/range/{prefix}`, 32 at a
time, retrying a range the API refuses for a while, and reports every 16 384 ranges. It writes the
file only when every range has arrived, building it beside `-out` under another name until then: a
build that fails or is stopped leaves no new file behind, and any file already at `-out` as it was,
so run it again.

- **To build from a corpus already on disk**, the single text file of `SHA1:COUNT` lines in
  ascending order that the official *PwnedPasswordsDownloader* writes:
  `go run ./cmd/breach-dataset -from pwnedpasswords.txt -out /tmp/breached.bin`. A file out of
  order is refused; sort it first.
- **To trade coverage for size**, `-min-count 2` keeps only the hashes seen at least twice. NIST SP
  800-63B asks for breached passwords, not popular ones, so the default keeps them all; use it only
  where the disk cannot hold the full file.
- `-workers` sets how many ranges download at once. Be gentle: the API is a free service.

The command prints how many prefixes it wrote. A full build holds about a billion, about 8 GB.

## Deploy it

1. Copy the file to the server's volume beside the old one, under a new name.
2. Point `HOUSEHOLD_BREACH_CORPUS` at the new file and restart the API. The server opens the
   file at start and checks its header and size; one that is not a whole corpus stops it with a
   message naming the file, so a bad copy never serves.
3. Delete the old file once the new one is serving.

## Check it

Registering with a password everybody knows is breached, `password1234`, answers `422`, naming
`/password` with the code `invalid`. Any long random password is accepted.
