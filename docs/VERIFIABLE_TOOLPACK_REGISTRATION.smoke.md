# verifiable-toolpack-registration — Smoke Suite

Manual smoke test for [#911](https://github.com/EnterpriseBT/portal-ai/issues/911): a toolpack server can verify every request, including the registration-time `/schema` and `/metadata` fetches. The register dialog generates the signing secret, the builder sets it on their server first, and the API signs with it. A refused signature is `502 TOOLPACK_SIGNATURE_REJECTED`. **Branch under test:** `feat/911-verifiable-toolpack-registration` (PR [#930](https://github.com/EnterpriseBT/portal-ai/pull/930)).

Run **Preflight** once. After that each section stands alone. Tags: untagged = agent-walkable in the browser (`/smoke-walk`); `— backend` = a terminal/API/DB check; `— manual` = needs a human (another machine, AWS, judgment).

---

## Preflight

### Environment

- [ ] `git checkout feat/911-verifiable-toolpack-registration && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`: core gained `SigningSecretSchema` and `generateSigningSecret`, so the API and web need the rebuilt dist. **No migration.**
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Touch an `apps/api/src` file after the core rebuild so nodemon reloads it.
- [ ] Login lands on the app as the e2e fixture owner (`npm run --workspace @portalai/e2e e2e:seed`, then `e2e:auth`).

### Fixtures

- [ ] The `e2e-fixture` org is on a tier with **custom toolpacks** (Settings → Billing, or Toolpacks shows an enabled **Register toolpack** button).
- [ ] A second terminal for the mock toolpack server (`apps/api/src/scripts/mock-toolpack-server.ts`). It verifies **every** route, `GET`s included, whenever `MOCK_TOOLPACK_SIGNING_SECRET` is set, and logs `Signature: OK` / `SIGNATURE_INVALID` / `SKIPPED` per request.

### Reset between runs

- [ ] Delete the toolpacks the walk registered (`smoke_911_*`) from Toolpacks → row → Delete. Stop the mock server (Ctrl-C) between sections that change its secret.

---

## §1 — Register dialog: the secret field

- [ ] Toolpacks → **Register toolpack**. The dialog shows a required **Signing secret** field, already filled with `whsec_` + 43 characters, in monospace.
- [ ] The helper text reads: "Set this secret on your toolpack server before registering. Portals AI signs every request with it, including the schema fetch. Use a different secret for each toolpack."
- [ ] Click **Generate a new signing secret** (the circular-arrows icon). The value changes and still matches `whsec_` + 43 characters.
- [ ] Click **Copy signing secret**. The icon turns into a check (its label becomes "Copied") for about 2 s, and pasting elsewhere gives the field's value.
- [ ] Replace the value with `hunter2`, fill the other required fields, click **Register**. The field shows "Signing secret must be whsec_ followed by 43 characters. Generate one rather than typing it.", it's marked invalid, and nothing registers.
- [ ] Click **Cancel**, then reopen **Register toolpack**. The secret field holds the **same** value as before Cancel (generate a fresh one first if `hunter2` is still there).

## §2 — Register against a server that verifies everything (AC 1)

- [ ] Open **Register toolpack** and copy the generated secret.
- [ ] In the second terminal — backend: `cd apps/api && MOCK_TOOLPACK_SIGNING_SECRET=<copied secret> npm run webhook:toolpack` (listens on `http://localhost:4100`).
- [ ] Fill in: Name `smoke_911_verified`, Schema `http://localhost:4100/schema`, Runtime `http://localhost:4100/runtime`, Metadata `http://localhost:4100/metadata`. Click **Register**.
- [ ] The dialog closes and `smoke_911_verified` appears in the list with its tools (`echo`, `add_numbers`, …). **No** "Your toolpack signing secret" reveal dialog opens.
- [ ] Mock server log — backend: the `GET /schema` and `GET /metadata` lines each show `Signature: OK` (not `SKIPPED`).
- [ ] Click the row's **Refresh**. A "Refreshed "smoke_911_verified"." toast appears, and the mock log shows `GET /schema` with `Signature: OK`.
- [ ] Runtime call — manual (needs the live agent): attach `smoke_911_verified` to a station, open a portal on it and prompt **"Use the echo tool to echo hello"**. The agent answers with the echoed value, and the mock log shows `POST /runtime` with `Signature: OK`.
- [ ] `db:studio` → `organization_toolpacks` — backend: the `smoke_911_verified` row's `signing_secret` is ciphertext, not the `whsec_` value.

## §3 — Wrong secret on the server (AC 4)

- [ ] Restart the mock — backend: `MOCK_TOOLPACK_SIGNING_SECRET=whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA npm run webhook:toolpack`.
- [ ] Open **Register toolpack** and keep the generated secret (which differs from the mock's). Name `smoke_911_mismatch`, the same three `localhost:4100` URLs, then **Register**.
- [ ] The dialog **stays open** with an error alert containing "rejected the request's signature (401)", "Verifying requests", and the code `TOOLPACK_SIGNATURE_REJECTED`.
- [ ] The list has **no** `smoke_911_mismatch` row; reload the page to confirm.
- [ ] Mock log — backend: `GET /schema` shows `SIGNATURE_INVALID`.
- [ ] Recover: click **Cancel**, reopen, and paste `whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` into the secret field, then **Register**. It now registers.

## §4 — API caller that omits the secret; existing toolpacks (AC 2, AC 3)

A toolpack registered without a supplied secret has the same stored shape as one registered before this change, so this section covers both.

- [ ] Restart the mock **without** a secret — backend: `npm run webhook:toolpack` (logs `SKIPPED`).
- [ ] Backend: `POST http://localhost:3001/api/toolpacks` with the fixture owner's bearer token and body `{"name":"smoke_911_minted","endpoints":{"schema":"http://localhost:4100/schema","runtime":"http://localhost:4100/runtime"}}`. Expect **201**, with `payload.signingSecret` matching `^whsec_[A-Za-z0-9_-]{43}$`. Copy it.
- [ ] `GET /api/toolpacks/<id>` — backend: the response has `signingSecretStatus.has: true` and does **not** contain the copied secret.
- [ ] Restart the mock with `MOCK_TOOLPACK_SIGNING_SECRET=<that minted secret>`, then click the row's **Refresh** in the UI. It succeeds and the mock shows `Signature: OK`.
- [ ] Row → **Edit** → **Rotate signing secret**. The reveal dialog shows a new secret. Restart the mock with it and **Refresh** again; it succeeds.
- [ ] Restart the mock with the **old** minted secret and **Refresh**. The toast reads "Failed to refresh "smoke_911_minted": …rejected the request's signature (401)…".
- [ ] Registering through the API with a supplied secret — backend: same POST, plus `"signingSecret":"<a generated whsec_ value>"` and name `smoke_911_supplied`, against a mock holding that secret. Expect **201**, with no `signingSecret` anywhere in the response body.

## §5 — Verification snippets and docs (AC 6)

- [ ] In the register dialog, expand "See how to verify our signed requests on your server" and open each tab: **TypeScript**, **Python**, **C#**. Each has the comment "Verify every request: the catalog GETs (schema, metadata) are signed over an empty body…" and **no** "Let GETs through" branch (no `req.method === "GET"`, `request.method == "GET"` or `HttpMethods.IsGet`).
- [ ] Help → Glossary → **Signing Secret**. It says the register dialog generates the secret, to set it on your server before registering, and names `TOOLPACK_SIGNATURE_REJECTED`. There's no "One exception" paragraph.
- [ ] `docs/CUSTOM_TOOLPACK_INTEGRATION.md` — manual (read): "Which requests you can verify" says all of them, the Node/Python/Go snippets have no GET passthrough, and the failure table lists `TOOLPACK_SIGNATURE_REJECTED`.

## §6 — Demo seed and demo Lambda (AC 5)

Locally the mock server stands in for the Lambda.

- [ ] Backend: pick a provisioned org id (`npx portalai org list --env local --json`). Start the mock with `MOCK_TOOLPACK_SIGNING_SECRET=<secret A>`.
- [ ] Backend: `cd apps/api && DEMO_TOOLPACK_URL=http://localhost:4100 DEMO_TOOLPACK_SIGNING_SECRETS="<secret A>,<secret B>" npm run db:demo:seed -- --org <id> --rows 0`. The output's `toolpacks.custom` is a non-null id, and the mock logs `Signature: OK` on `/schema` and `/metadata`.
- [ ] Re-run the same command. `toolpacks.custom` is the **same** id, and the mock still logs `Signature: OK` (the secret was kept).
- [ ] Re-run **without** `DEMO_TOOLPACK_SIGNING_SECRETS`. It still registers with `Signature: OK`: the seed reused the stored secret.
- [ ] Restart the mock with a different secret and re-run. The seed logs "custom toolpack refresh failed — keeping the registered one". In the org's station, the `demo_supply_tools` toolpack is **still attached** (Stations → station → toolpack chips).
- [ ] Deployed Lambda — manual (after merge, per the PR's release order): with the `portalai-demo-toolpack` stack's `SigningSecrets` set, `curl <FUNCTION_URL>/schema` without signing headers gives **401**, and a correctly signed `GET` gives **200**.

## §7 — Error & edge cases

- [ ] PATCH refuses the field — backend: `PATCH /api/toolpacks/<id>` with `{"signingSecret":"<valid whsec_>"}` gives **400 `TOOLPACK_INVALID_PAYLOAD`**.
- [ ] Metadata-only refusal — backend: register through the API with a secret the mock holds, but a metadata URL on a second mock (`PORT=4101 MOCK_TOOLPACK_SIGNING_SECRET=<other> npm run webhook:toolpack`) that holds a different secret. Expect **502 `TOOLPACK_SIGNATURE_REJECTED`** with `details.url` = the `:4101/metadata` URL, and nothing registered.
- [ ] The API log — backend: `grep -c whsec_` over the API's dev log for this walk gives **0**. The "Toolpack registered" lines show `secretSource: "supplied"` or `"minted"`.

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/toolpack ids, mock log excerpt):
