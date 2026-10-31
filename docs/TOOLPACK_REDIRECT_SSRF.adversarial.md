# toolpack-redirect-ssrf — Adversarial Review

Adversarial probes for [#931](https://github.com/EnterpriseBT/portal-ai/issues/931). `guardedFetch` checks the address of every connection a toolpack or REST request makes, toolpacks refuse redirects, and REST follows at most 5 checked hops. **Branch under test:** `fix/931-toolpack-redirect-ssrf` (PR [#932](https://github.com/EnterpriseBT/portal-ai/pull/932)).

Every probe here tries to make the API connect to an address it must not reach, or to leak something on the way. "Safe" means the request is refused **before a connection is made** (or the hop is refused), nothing from the internal host reaches the caller, and no credential leaves its origin.

Tags:
- untagged = browser-walkable;
- `— backend` = an API, DB or terminal probe;
- `— manual` = needs a human.

Most probes are `— backend`, sent straight to the REST preview route, because the REST connector has **no static URL check** in front of it. That makes it the purest test of the connect-time guard.

## Preflight

### Environment
- [ ] Same as the smoke doc's Preflight: the branch is checked out, `npm run dev` is up (web `:3000`, API `:3001`), the fixture owner is signed in, and `DISABLE_OUTBOUND_URL_GUARD` is **unset or `false`** in `apps/api/.env`.
- [ ] A bearer token for the fixture owner, taken from the signed-in browser session. All `— backend` probes use it.

### Fixtures
- [ ] **The preview request.** Every REST probe below is `POST /api/connector-instances/preview-endpoint-page` with this body, varying only `baseUrl`:
  ```json
  {"baseUrl":"<URL>","auth":{"mode":"none"},"credentials":null,"endpoint":{"path":"/x","method":"GET","recordsPath":"","pagination":{"strategy":"none"}}}
  ```
  Shape the `endpoint` object to `ApiEndpointConfigSchema` if the route answers 400. It's the same body the wizard's **Preview** sends.
- [ ] **The two helper servers from the smoke doc's Fixtures:** the redirector (`node redirector.mjs <port> <target>`) and the records server (`node records.mjs <port>`). Both log every request.
- [ ] **A custom redirect server.** For the Location probes, a one-off variant of the redirector that answers with a fixed `Location` header taken from argv. It runs on `:4106`.
- [ ] **Docker names.** The local Docker services resolve from the API container: `postgres` → `172.18.0.5`, `redis` → `172.18.0.2`, `host.docker.internal` → a ULA IPv6 address.

### Reset between runs
- [ ] Delete any `adv_931_*` toolpacks or connections a probe created. Stop the helper servers.

---

## §1 — Boundary & limit inputs
- [ ] A REST base URL behind exactly **5** redirects: a chain of 5 hops through the redirector to the records server. — backend — expected SAFE: **200**, both records returned. The limit is inclusive.
- [ ] The same base URL behind **6** redirects. — backend — expected SAFE: **502 `REST_API_URL_BLOCKED`**, `reason: too-many-redirects`. The records server logs **no** request.

## §2 — Malformed & injection input (address encodings)
Each is a REST base URL sent to the preview route. Expected SAFE for every row: **502 `REST_API_URL_BLOCKED`**, `details.reason: "private-address"`, answered in well under a second (no connect timeout), and no `details` field that echoes a resolved address beyond the URL itself.
- [ ] Decimal IPv4: `http://167772161/` (= `10.0.0.1`). — backend
- [ ] Hex IPv4: `http://0x0a000001/`. — backend
- [ ] Octal and short form: `http://012.0.0.1/` and `http://10.1/`. — backend
- [ ] IPv4-mapped IPv6 to cloud metadata: `http://[::ffff:a9fe:a9fe]/` (= `169.254.169.254`). — backend
- [ ] Unique-local IPv6: `http://[fd00::1]/`. — backend
- [ ] The unspecified address: `http://0.0.0.0/` and `http://[::]/`. — backend. Expected SAFE also in dev: `0.0.0.0` isn't loopback, so it's refused even though loopback is allowed.
- [ ] A trailing-dot name: `http://10-255-255-1.nip.io./`. — backend
- [ ] Userinfo masking the host: `http://api.example.com@10.255.255.1/`. — backend. Expected SAFE: refused on the real host, `10.255.255.1`.
- [ ] Location headers from a public-looking server (a redirector on `:4106` with these exact values; this one passes the first-hop check on loopback in dev):
  - `Location: file:///etc/passwd` and `Location: gopher://10.0.0.1:6379/_INFO`. — backend — expected SAFE: `REST_API_URL_BLOCKED` with `reason: unsupported-scheme`, and no file or gopher request is made.
  - `Location: //10.0.0.1/x` (scheme-relative). — backend — expected SAFE: resolved against the current hop to `http://10.0.0.1/x`, then refused with `private-address`.
  - `Location: http://[::ffff:7f00:1]:3001/api/health`, an IPv4-mapped form of loopback that points at the API itself. — backend — expected SAFE: refused with `private-address`. An IPv4-mapped address isn't classed as loopback, even in dev.

## §3 — Concurrency & races (DNS rebinding)
- [ ] A rebinding name that alternates per lookup between a public address and `10.0.0.1`: `http://5db8d822.0a000001.rbndr.us/` (rbndr.us answers randomly with `93.184.216.34` or `10.0.0.1`). Send the preview **10 times**, spaced a few seconds apart: a caching resolver can pin one answer (six back-to-back lookups from the dev container all returned `10.0.0.1`), so check the split with `node -e 'require("dns").lookup(…)'` first. — backend — expected SAFE, every time: either the request reaches the public address (or fails to connect to it), or it's refused with `private-address`. It **never** produces a connect timeout to `10.0.0.1` (a ~10 s `REST_API_FETCH_FAILED` would mean it tried). Record the split.
- [ ] Rebinding behind a redirect: the redirector on `:4106` answers `Location: http://5db8d822.0a000001.rbndr.us/x`. Send it 10 times. — backend — expected SAFE: the same as above for the second hop.
- [ ] A keep-alive connection doesn't carry an unchecked address. With the records server on loopback, send two previews back to back (the second may reuse the pooled socket). — backend — expected SAFE: both succeed. A pooled socket was checked when it opened, and a rebinding name can't swap one in.

## §4 — Auth & permission boundaries
- N/A — #931 changes no route, permission check or entitlement. Who may create a REST connection or register a toolpack is unchanged; this ticket only limits *where* those requests may go.

## §5 — Multi-tenant isolation (reaching shared infrastructure)
- [ ] A REST base URL at the shared Postgres or Redis by their Docker names: `http://postgres:5432/` and `http://redis:6379/`. — backend — expected SAFE: `REST_API_URL_BLOCKED`, `private-address`. The service logs show no connection from the API.
- [ ] `http://host.docker.internal:3001/api/health` (the API host's own address, ULA IPv6). — backend — expected SAFE: refused with `private-address`.
- [ ] A toolpack that tries to reach Redis through the register dialog: Schema `https://redis.10-255-255-1.nip.io/schema`, or any public name resolving into `172.18.0.0/16`. Register it. — expected SAFE: the dialog shows `TOOLPACK_URL_PRIVATE_HOST` and nothing is registered.

## §6 — State & lifecycle abuse
- [ ] **A REST connection saved before this change, pointing at a private host.** Insert or edit one in the DB with `config.baseUrl = "http://10.255.255.1"` (as a pre-#931 connection could have been), then click **Sync now**. — expected SAFE:
  - the `connector_sync` job fails with an error naming `REST_API_URL_BLOCKED`;
  - no records are written;
  - the connection page shows the failure.

  Record the job's `attempts`. A job-level retry of a deterministic refusal is a finding, low.
- [ ] **A toolpack registered before this change at a private host.** Edit a registered toolpack's `endpoints.runtime` in the DB to `https://10-255-255-1.nip.io/runtime` (bypassing the contract, as an old row could be). — backend, then manual — expected SAFE:
  - **Refresh** is refused with `TOOLPACK_URL_PRIVATE_HOST`, and the tools are unchanged;
  - an agent call to one of its tools returns the typed `TOOLPACK_URL_PRIVATE_HOST` result (the agent step is manual).
- [ ] **A redirecting server that changes mid-sync.** Start a REST sync of the smoke doc's `smoke_931_rest_redirect` connection, and while it runs, switch the redirector to `Location: http://10.0.0.1/users`. — backend — expected SAFE: any request after the switch is refused, and the job reports `REST_API_URL_BLOCKED` instead of hanging on a connect timeout.

## §7 — Misuse sequences
- [ ] **https → http downgrade on the same host.** A REST connection with Bearer auth whose first hop redirects to `http://` on the same hostname and port. — backend — expected SAFE: the scheme changes the origin, so the `authorization` header is **dropped** on that hop (check the target server's log).
- [ ] **Away and back.** Origin A redirects to B (a different port), and B redirects back to A. — backend — expected SAFE: A's second request carries **no** `authorization`. Headers dropped on the cross-origin hop stay dropped.
- [ ] **A POST endpoint with a 307 to another origin.** Use a REST endpoint with `method: "POST"` and a body template, where the first hop answers `307` to another loopback port. — backend — expected: the body is resent (fetch's 307 rule), while auth headers are dropped. Record it as informational: the body is the org's own request payload.
- [ ] **A toolpack server answering `300 Multiple Choices` or `304`** with a `Location`. — backend — expected SAFE: `300` and `304` aren't followed or treated as redirects. Registration fails with `TOOLPACK_SCHEMA_FETCH_FAILED` ("returned 300/304"), and no request reaches the `Location`.
- [ ] **A redirect to the same URL** (a self-loop) on a toolpack schema endpoint. — expected SAFE: one request, then `TOOLPACK_REDIRECT_REFUSED`. No loop.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/connection/toolpack/job ids, helper-server log excerpt):
