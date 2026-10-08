# Sign-in keys, identity providers and the oldest client served

Signing in on a phone, the second step, and signing in with Google or Apple each need settings of
their own in every environment but development
([ADR 0010](../adr/0010-mobile-tokens-second-step-providers-and-client-versions.md)). This runbook
says how to make them, how to rotate them, and how to register the server with each provider.

Every value here is a secret except the redirect URIs, the client ids and the versions. Keep them in
the environment's secret store, never in the repository or an image. The server never names a key
in its log or its errors.

## The two keys

| Variable | What it holds | What it protects |
|---|---|---|
| `HOUSEHOLD_TOKEN_KEYS` | Ed25519 seeds, 32 bytes each | The signature on every device's access token, and on PowerSync's tokens once plan item 13 lands |
| `HOUSEHOLD_MFA_KEYS` | AES-256 keys, 32 bytes each | Every account's authenticator secret, sealed, and its recovery codes, keyed |

Each is a comma-separated list of values in base64. The first value signs or seals; every value
verifies or opens. Outside development the server does not start without both, nor with the
published development values.

### Make one

Any 32 random bytes are a valid key of either kind:

```bash
openssl rand -base64 32
```

Set the variable to that value alone for a new environment.

### Rotate the token key

1. Make a new value and put it **first**: `HOUSEHOLD_TOKEN_KEYS=<new>,<old>`. Deploy.
2. Wait fifteen minutes, the access tokens' lifetime, after the last instance restarted.
3. Drop the old value: `HOUSEHOLD_TOKEN_KEYS=<new>`. Deploy.

A device whose access token the old key signed simply refreshes it; nobody is signed out. If the old
key leaked, skip the wait: every access token it signed stops at once, and each device refreshes.

### Rotate the MFA key

1. Make a new value and put it **first**: `HOUSEHOLD_MFA_KEYS=<new>,<old>`. Deploy.
2. **Keep the old value listed.** A secret sealed under it is sealed again under the new key the next
   time its owner signs in with a code, and recovery codes move when a new set is made; there is no
   job that moves them all. Dropping the old value locks every account still sealed under it out of
   its second step, and each then needs support to turn it off.

If the old key leaked, keep it listed, and ask every account with the second step on to turn it off
and on again, which seals a new secret and makes new codes under the new key.

## The oldest client served

`HOUSEHOLD_MIN_MOBILE_VERSION` and `HOUSEHOLD_MIN_WEB_VERSION` each hold a version, `1.6.0`; a
client below it gets *please update* on every request (PRD 06 §7). Unset, every version is served.
Raise the mobile minimum only once the version it names is live in both stores, and the server has
served the previous minor for six months. The web app names itself by the version in
`apps/web/package.json` with its build's id after it, `web/0.1.0+3f2a…`, and the version is raised
only by a change after which older builds must be refused (D-158): raise the web minimum to that
version once the build that names it is live, and not before, or every web client is refused, the
newest with the rest. A web client below the minimum draws *please update*, whose action is a reload
([ADR 0026](../adr/0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md)).

## Google

1. In the Google Cloud console, under *APIs & Services → Credentials*, create an **OAuth client ID**
   of type *Web application* for the environment.
2. Add each redirect URI the clients use under *Authorized redirect URIs*, exactly as they send it.
3. Set `HOUSEHOLD_GOOGLE_CLIENT_ID` and `HOUSEHOLD_GOOGLE_CLIENT_SECRET`.

## Apple

1. In the Apple Developer account, create a **Services ID** for the web and register its return URLs;
   its identifier is the client id.
2. Create a **key** with *Sign in with Apple* enabled, download its `.p8` file once, and note its key
   id and the team id.
3. Set `HOUSEHOLD_APPLE_CLIENT_ID`, `HOUSEHOLD_APPLE_TEAM_ID`, `HOUSEHOLD_APPLE_KEY_ID`, and
   `HOUSEHOLD_APPLE_PRIVATE_KEY` to the `.p8` file's contents, the PEM block whole.

Apple returns a person who is asked for an address or a name with a form posted to the return URL,
not a redirect with a query: the page at that URL must accept a `POST`. The web client is static
files and accepts none, so its return URL for Apple is the API's own,
`https://app.household.example/api/v1/auth/oauth/apple/return`, which reads the form and sends the
browser on to the web client's `sign-in/apple` with what Apple sent in the fragment
([ADR 0026](../adr/0026-the-web-shell-the-session-the-replica-in-a-browser-and-one-language-at-a-time.md)). Register that address
as the Services ID's return URL. It is the one route that takes an unsafe request from another
site's origin, Apple's `https://appleid.apple.com`, and it reads no session.

## The redirect URIs

`HOUSEHOLD_OAUTH_REDIRECT_URIS` lists every URI a provider may send a person back to, comma-separated,
each matched exactly: no prefix, no wildcard. The web client sends two, both at its own origin:
`https://app.household.example/sign-in/google` for Google, and
`https://app.household.example/api/v1/auth/oauth/apple/return` for Apple (above). The mobile app's is an `https` URL too, one the app opens as a universal link (iOS) and an
app link (Android), such as `https://app.household.example/sign-in/mobile`: the server redeems the
code as the web client Google knows and the Services ID Apple knows, and neither accepts a custom
scheme such as `household://` as a return URL. A provider configured with no URI stops the server at
start. Each provider must list the same URIs on its side, or it refuses the sign-in before the server
sees it.

A provider is configured whole or not at all: a client id without its secret, or Apple without its
key, stops the server at start, naming what is missing. A provider not configured answers `404`, and
the clients do not offer it: `GET /api/v1/auth/oauth` names the ones that are, and a sign-in screen
draws those and no other.

A provider that refuses the server itself, `invalid_client` or `unauthorized_client`, because the
Google secret was rotated at Google or the Apple key was revoked, fails every sign-in with it `500`,
and each is logged as `identity request failed` with the provider's error. Mend the setting and
redeploy. So does any other answer from its token endpoint but `invalid_grant`, a `429` that
throttles the server or an `invalid_request` among them, and an ID token the server cannot verify:
its keys unreachable from the server (`fetching keys` in the log), or the server's clock off. Only a
person's own refused sign-in, `invalid_grant` for their code or an ID token that is another
sign-in's, answers `401`, and is not logged.
