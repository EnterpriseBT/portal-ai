# toolpack-redirect-ssrf — Smoke Suite

Manual smoke test for [#931](https://github.com/EnterpriseBT/portal-ai/issues/931). Every fetch to an org-supplied URL (custom toolpack registration, refresh and runtime calls, and every REST connection request) is checked for a public address on every connection, including redirect hops. Toolpacks refuse redirects; REST follows at most 5 checked hops without auth headers across origins. **Branch under test:** `fix/931-toolpack-redirect-ssrf` (PR [#932](https://github.com/EnterpriseBT/portal-ai/pull/932)).

Run **Preflight** once; after that each section stands alone. Tags:
- untagged = agent-walkable in the browser (`/smoke-walk`);
- `— backend` = a terminal, API or DB check;
- `— manual` = needs a human.

Locally, loopback (`localhost`, `127.0.0.1`) is allowed, so local mock servers work. Private addresses are exercised with an IP literal (`10.255.255.1`) or with `10-255-255-1.nip.io`, a public DNS name that resolves to `10.255.255.1`. That proves the connect-time check: no static check sees the address.

---

## Preflight

### Environment

- [ ] `git checkout fix/931-toolpack-redirect-ssrf && git pull --ff-only`
- [ ] `npm install`. `undici` is now a direct `apps/api` dependency, at the version Node 22 bundles. **No migration.**
- [ ] In `apps/api/.env`, rename `TOOLPACK_DISABLE_SSRF_FILTER` to `DISABLE_OUTBOUND_URL_GUARD`, or delete the line. Leave it **unset or `false`** for this walk: with it `true`, nothing here is refused.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] You're logged in as the e2e fixture owner (`npm run --workspace @portalai/e2e e2e:auth`).
- [ ] DNS check — backend: `node -e 'require("dns").lookup("10-255-255-1.nip.io",(e,a)=>console.log(a))'` prints `10.255.255.1`.

### Fixtures

- [ ] The `e2e-fixture` org is on a tier with **custom toolpacks** (Toolpacks shows an enabled **Register toolpack**).
- [ ] The mock toolpack — backend: `cd apps/api && npm run webhook:toolpack` (`:4100`, no signing secret, so it accepts unsigned requests).
- [ ] A redirect server — backend. Save it as `/tmp/redirector.mjs` and run it with `node /tmp/redirector.mjs <port> <target-base>`. It answers every request with `302` to `<target-base><same path>` and logs each request's method, path and `authorization` header:
  ```js
  import http from "node:http";
  const [port, target] = process.argv.slice(2);
  http.createServer((req, res) => {
    console.log(req.method, req.url, "auth=" + (req.headers.authorization ?? "-"));
    res.writeHead(302, { location: target + req.url });
    res.end();
  }).listen(Number(port), () => console.log("redirecting", port, "->", target));
  ```
- [ ] A JSON server that logs headers — backend. Save it as `/tmp/records.mjs` and run it with `node /tmp/records.mjs <port>`. It answers any path with `{"items":[{"id":"r1","name":"One"},{"id":"r2","name":"Two"}]}` and logs `authorization` and `accept`:
  ```js
  import http from "node:http";
  const port = Number(process.argv[2]);
  http.createServer((req, res) => {
    console.log(req.method, req.url, "auth=" + (req.headers.authorization ?? "-"), "accept=" + req.headers.accept);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "r1", name: "One" }, { id: "r2", name: "Two" }] }));
  }).listen(port, () => console.log("records on", port));
  ```

### Reset between runs

- [ ] Delete the toolpacks and REST connections the walk created (names start `smoke_931_`). Stop the helper servers (Ctrl-C).

---

## §1 — Toolpack registration refuses redirects (AC 1)

- [ ] Backend: start `node /tmp/redirector.mjs 4102 http://localhost:4100`.
- [ ] Toolpacks → **Register toolpack**. Enter:
  - Name `smoke_931_redirect`;
  - Schema `http://localhost:4102/schema`;
  - Runtime `http://localhost:4100/runtime`;
  - leave Metadata empty.

  Click **Register**.
- [ ] The dialog **stays open**. Its error alert reads "The toolpack server at http://localhost:4102/schema answered with a redirect (302). Toolpack URLs aren't followed through redirects; register the final URL." and shows the code `TOOLPACK_REDIRECT_REFUSED`.
- [ ] The alert doesn't name the redirect's target (`localhost:4100`). Reload the page: there's **no** `smoke_931_redirect` row.
- [ ] Redirector log — backend: exactly one `GET /schema`. Mock log: **no** `GET /schema` (the redirect wasn't followed).
- [ ] Change Schema to `http://localhost:4100/schema` and set Metadata to `http://localhost:4102/metadata`, then **Register**. It fails the same way, naming `http://localhost:4102/metadata`. A redirecting metadata endpoint fails the registration.
- [ ] Clear Metadata and **Register** with Schema `http://localhost:4100/schema`. It registers, with the mock's tools listed.

## §2 — Toolpack URLs that resolve to a non-public address (AC 2)

- [ ] **Register toolpack** with:
  - Name `smoke_931_private`;
  - Schema `https://10-255-255-1.nip.io/schema`;
  - Runtime `https://10-255-255-1.nip.io/runtime`.

  Click **Register**.
- [ ] The dialog stays open with "The toolpack URL https://10-255-255-1.nip.io/schema resolves to an address that isn't public." and `TOOLPACK_URL_PRIVATE_HOST`. The alert doesn't show `10.255.255.1`, and it appears immediately, not after a 30 s timeout: the connection was refused before it was made.
- [ ] Metadata stays best-effort for an unresolvable host. Register `smoke_931_meta_nxdomain` with:
  - Schema `http://localhost:4100/schema`;
  - Runtime `http://localhost:4100/runtime`;
  - Metadata `https://smoke-931.invalid/metadata`.

  It **registers**, without metadata (no icon or description from metadata).
- [ ] Register `smoke_931_meta_private` with the same schema and runtime and Metadata `https://10-255-255-1.nip.io/metadata`. It **fails** with `TOOLPACK_URL_PRIVATE_HOST` naming the metadata URL.

## §3 — Refresh of a registered toolpack whose server now redirects (AC 1)

- [ ] Backend: stop the mock on `:4100`, then start `node /tmp/redirector.mjs 4100 http://localhost:4101` in its place.
- [ ] On the toolpack registered at the end of §1, click **Refresh**. A toast reads "Failed to refresh "smoke_931_redirect": …answered with a redirect (302)…".
- [ ] The row's tool count and **Last refreshed** time are unchanged.
- [ ] Backend: stop that redirector and restart the mock (`npm run webhook:toolpack`). **Refresh** succeeds again.

## §4 — Runtime tool call through a redirect (AC 1) — manual

- [ ] Manual (needs the live agent):
  - Edit the toolpack from §1 so Runtime is `http://localhost:4102/runtime`, with the §1 redirector running.
  - Attach the toolpack to a station, open a portal and prompt **"Use the echo tool to echo hello"**.
  - Expected: the agent says the tool couldn't reach its server and names `TOOLPACK_REDIRECT_REFUSED`. It doesn't show an echoed result. The redirector logs one `POST /runtime`, and the mock logs **no** `/runtime` request.

## §5 — REST connections (AC 2, AC 3, AC 4)

- [ ] Connectors → add a **REST API** connection named `smoke_931_rest_private` with base URL `http://10.255.255.1`, no auth, and an endpoint `GET /users` with records path `items`. Use the endpoint's **Preview** (or, after saving, the connection page's endpoint **Test**).
- [ ] The preview or test fails with "This connection's URL resolves to an address that isn't public." (`REST_API_URL_BLOCKED`), immediately, with no retry spinner.
- [ ] Change the base URL to `https://10-255-255-1.nip.io` and preview again. Same refusal: the connect-time check catches a name that resolves to a private address.
- [ ] Backend: start `node /tmp/records.mjs 4104` and `node /tmp/redirector.mjs 4103 http://127.0.0.1:4104`.
- [ ] Create `smoke_931_rest_redirect` with base URL `http://localhost:4103`, **Bearer** auth with token `smoke931token`, and the same endpoint. **Preview** shows the two records `r1` / `One` and `r2` / `Two`: the public, here loopback, redirect was followed.
- [ ] Redirector log — backend: `GET /users auth=Bearer smoke931token` (the first hop is the connection's own origin). Records-server log: `GET /users auth=-`, with `accept` still present. The bearer token **didn't** follow the redirect to the other origin.
- [ ] Backend: restart the redirector so it redirects to itself (`node /tmp/redirector.mjs 4103 http://localhost:4103`), then **Preview** again. It fails with "The endpoint redirected more than 5 times." (`REST_API_URL_BLOCKED`), and the redirector logs exactly **6** requests.
- [ ] Sync: save `smoke_931_rest_redirect` (redirector pointed back at `:4104`) and run a sync. It completes with 2 records. — backend: the records-server log shows the requests with `auth=-`.

## §6 — Error & edge cases (AC 5, AC 6, AC 7)

- [ ] Body hygiene — backend: point a toolpack registration at a server that returns `200` with the body `SECRET-BODY not json` (a one-line `node -e` HTTP server on `:4105`). Expect **502 `TOOLPACK_SCHEMA_INVALID`** "The toolpack response from … is not valid JSON.", which doesn't contain `SECRET`.
- [ ] The guard flag — backend:
  - Run a second API on a spare port with `DISABLE_OUTBOUND_URL_GUARD=true` (`cd apps/api && PORT=3011 DISABLE_OUTBOUND_URL_GUARD=true node --env-file=.env dist/index.js`, after `npm run build`).
  - The §2 nip.io registration sent to `:3011` now gets past the address check, failing instead with a connect timeout or `TOOLPACK_SCHEMA_FETCH_FAILED`, not `TOOLPACK_URL_PRIVATE_HOST`.
  - The §1 redirect registration sent to `:3011` is **still** refused with `TOOLPACK_REDIRECT_REFUSED`.
  - Stop `:3011` afterwards.
- [ ] The old flag name is inert — backend: `grep -rn TOOLPACK_DISABLE_SSRF_FILTER apps/api/src apps/api/.env.example apps/api/README.md docs/*.md` finds nothing outside this ticket's phase docs.
- [ ] Integration guide — manual (read):
  - `docs/CUSTOM_TOOLPACK_INTEGRATION.md` → "URL requirements" says every connection is checked and redirects aren't followed.
  - The troubleshooting table has a `TOOLPACK_REDIRECT_REFUSED` row.
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1 describes the connect-time check for both REST connections and webhook toolpacks.

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/toolpack/connection ids, helper-server log excerpt):
