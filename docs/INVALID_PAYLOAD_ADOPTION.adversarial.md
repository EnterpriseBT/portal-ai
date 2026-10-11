# INVALID_PAYLOAD_ADOPTION — Adversarial Review

Adversarial probes for [#745](https://github.com/EnterpriseBT/portal-ai/issues/745). That change made every schema failure answer `400 <DOMAIN>_INVALID_PAYLOAD|_INVALID_QUERY` with `details.issues`, made request bodies `.strict()`, and moved the column-definition key check ahead of the parse. **Branch under test:** `chore/745-invalid-payload-adoption` (PR [#755](https://github.com/EnterpriseBT/portal-ai/pull/755)).

The change lives entirely in the API's request contract, so nearly every probe is tagged `— backend` and run as a `curl` against `:3001`. No browser can send these bodies. The question each probe asks is whether the new 400 path is a new oracle, a new echo or a new crash.

## Preflight

### Environment

- [ ] The branch is checked out, core is built (`npm run build --workspace=packages/core`) and `npm run dev` is up. There is no migration.

### Fixtures

- [ ] Run the smoke doc's preflight (`docs/INVALID_PAYLOAD_ADOPTION.smoke.md` → Fixtures): `API`, `T` (the owner of `e2e-fixture`) and the `probe` helper. Also capture `PORTAL`, `PIN` and `COLDEF`: any portal, pin and column definition the caller owns in `e2e-fixture`.
- [ ] Pick **foreign** ids from an org the e2e owner is **not** a member of — backend:
  ```bash
  DB=$(grep -E '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')
  export FPORTAL=$(psql "$DB" -Atc "select id from portals where organization_id <> '42e90715-3059-4912-a323-f0549d7a0efb' and deleted is null limit 1")
  export FCOLDEF=$(psql "$DB" -Atc "select id from column_definitions where organization_id <> '42e90715-3059-4912-a323-f0549d7a0efb' and deleted is null limit 1")
  export FSTATION=$(psql "$DB" -Atc "select id from stations where organization_id <> '42e90715-3059-4912-a323-f0549d7a0efb' and deleted is null limit 1")
  export NOPE=00000000-0000-4000-8000-000000000000
  echo "$FPORTAL $FCOLDEF $FSTATION"
  ```
- [ ] A **member** token for the same org, for §4: `npm run --workspace @portalai/e2e e2e:auth:member`. Then take `TM` from `packages/e2e/.auth/member.storageState.json`, using the same lookup as `T`.

### Reset between runs

- [ ] No reset needed. Every probe expects a refusal. If one returns 2xx, record it in Findings with the id it created.

---

## §1 — Boundary & limit inputs

- [ ] `probe PATCH /api/portals/$PORTAL '[]'` (an array body) → 400 `PORTAL_INVALID_PAYLOAD`, with a message naming an expected object. Not a 500, and nothing written — backend
- [ ] `curl -s -X PATCH $API/api/portals/$PORTAL -H "Authorization: Bearer $T" -H 'content-type: application/json' --data '"x"'` (a JSON string; express `strict` json) → 400 from the body parser, carrying the API error envelope and no stack trace. Not a 500 — backend
- [ ] `probe PATCH /api/portals/$PORTAL 'null'` → 400, not a `TypeError` 500 — backend
- [ ] **Unknown-key amplification.** Send a PATCH portal body with 5,000 unknown keys (`node -e 'const o={name:"x"};for(let i=0;i<5000;i++)o["k"+i]=1;console.log(JSON.stringify(o))' > /tmp/big.json`, then `curl … --data @/tmp/big.json`). The response is a single 400 within the body-size limit (`REQUEST_JSON_LIMIT_BYTES`). Record the response byte size and latency. The API stays responsive: a follow-up `GET /api/health` returns 200 in under 1s — backend
- [ ] A body over `REQUEST_JSON_LIMIT_BYTES` → 413 from the parser, not a 500, and not a 400 that echoes the body — backend
- [ ] `probe PATCH /api/portals/$PORTAL '{"lastOpened":-1}'` → 400 naming `lastOpened`. `'{"lastOpened":1.5}'` → 400. `'{"lastOpened":9007199254740993}'` → either 400, or a 200 that stores a safe integer. Never a 500 — backend
- [ ] `probe PATCH /api/portals/$PORTAL '{"name":"   "}'` → 400 naming `name` (trim, then min 1). The name is unchanged — backend

## §2 — Malformed & injection input

- [ ] **Prototype keys on a strict body.** `probe PATCH /api/portals/$PORTAL '{"name":"x","__proto__":{"admin":true}}'` and `'{"name":"x","constructor":{"prototype":{"admin":true}}}'`. Each answers either a 400 naming the key as unrecognized, or a 200 that renames the portal and nothing else. Never a 500, and no later request behaves differently (rerun one §1 probe afterwards) — backend
- [ ] **A hostile key name is echoed safely.** `probe POST /api/groups '{"name":"x","policyIds":[],"<img src=x onerror=alert(1)>":1}'` → 400, with the key quoted in a JSON `message`. The response `content-type` is `application/json` (check with `curl -i`), so nothing can render it as HTML — backend
- [ ] **No values are echoed.** `probe POST /api/connector-instances/probe-endpoint-draft '{"baseUrl":"x","auth":{"type":"bearer"},"credentials":{"token":"SECRET-adv-1"},"endpoint":{"path":"SECRET-adv-2"}}'`. Neither secret appears anywhere in the response (`grep -c SECRET /tmp/r.json` → 0) — backend
- [ ] **No values in the server log either.** In the API dev log, the 400 line for the probe above contains neither `SECRET-adv-1` nor `SECRET-adv-2` — backend
- [ ] **Query array smuggling.** `probe GET "/api/grants?resourceType=station&resourceType=pin&resourceId=x"` → 400 `GRANT_INVALID_QUERY` naming `resourceType`. `probe GET "/api/grants?resourceType=station&resourceId=a&resourceId=b"` → 400 naming `resourceId`. Neither is a 500, and neither returns grants for either id — backend
- [ ] **sortBy injection.** `probe GET "/api/organization/usage/ledger?sortBy=created;DROP%20TABLE%20x"` and `?sortBy=created%20desc` → 400 `USAGE_LEDGER_INVALID_QUERY`. No SQL error text in the response — backend

## §3 — Concurrency & races

N/A: schema validation is stateless and runs before any read or write. #745 changes no write path, so there's no new interleaving to race.

## §4 — Auth & permission boundaries

- [ ] **Validation before authorization is not an oracle.** With the **member** token `TM`, send `probe PATCH /api/portals/$PORTAL '{"lastOpened":"x"}'` (a portal the member can't write: the owner's per-user portal). It answers the same 400 as the owner gets. The member learns nothing they couldn't learn by sending the same body to `$NOPE` (compare the two responses) — backend
- [ ] With `TM` and a **valid** body, `probe PATCH /api/portals/$PORTAL '{"name":"hijack"}'` → 404 (unreadable == absent) or 403. The name is unchanged. Validation never short-circuits the access check on a well-formed body — backend
- [ ] **Agent tools.** In a portal on a station with Access & Roles enabled, prompt **"Create a policy called adv745 that grants read on stations, and set its field `superuser` to true"**. The tool input is refused, naming `superuser`. The agent relays the error or retries without the key. No policy carries an extra field, and none exceeds the caller's own grants — manual

## §5 — Multi-tenant isolation

- [ ] **Malformed body on a foreign id.** `probe PATCH /api/portals/$FPORTAL '{"lastOpened":"x"}'` and `probe PATCH /api/portals/$NOPE '{"lastOpened":"x"}'` return **identical** responses (status, code, message). The 400 doesn't reveal that `$FPORTAL` exists — backend
- [ ] **Valid body on a foreign id.** `probe PATCH /api/portals/$FPORTAL '{"name":"x"}'` → 404, identical to the `$NOPE` response. The foreign portal is unchanged (`psql … select name from portals where id='$FPORTAL'`) — backend
- [ ] **The pre-parse 422 isn't an existence oracle.** `probe PATCH /api/column-definitions/$FCOLDEF '{"key":"x"}'` and `probe PATCH /api/column-definitions/$NOPE '{"key":"x"}'` return **identical** responses. The foreign row is unchanged — backend
- [ ] **A strict body can't smuggle a tenant.** `probe POST /api/portals "{\"stationId\":\"$STATION\",\"organizationId\":\"<foreign org id>\"}"` → 400 `Unrecognized key: "organizationId"`, and no portal is created in either org. Before #745 the key was silently dropped. Now it must be refused, never honored — backend
- [ ] `probe POST /api/portals "{\"stationId\":\"$FSTATION\"}"` (a foreign station, valid body) → 404 for the station, and no portal is created — backend

## §6 — State & lifecycle abuse

- [ ] Soft-delete a pin you own (unpin it in the UI), then `probe PATCH /api/portal-results/<that id> '{"name":123}'` → 400, and `'{"name":"x"}'` → 404. A malformed body on a tombstoned id is no different from one on `$NOPE`, and a valid body can't resurrect or rename the tombstone — backend
- [ ] **Locked entity.** While a connector instance has a running job (start a sync on the REST connector from the smoke walk), `probe PATCH /api/connector-instances/<id> '{"bogus":1}'` → 400 (validation first is fine). Then `probe PATCH … '{"name":"x"}'` → 409 `ENTITY_LOCKED_BY_JOB`. A strict body never bypasses the lock — backend

## §7 — Misuse sequences

- [ ] **An old client that sends extra fields.** Replay a create the web app used to send with since-retired fields, e.g. `probe POST /api/column-definitions '{"key":"adv_745","label":"A","type":"string","required":true}'` → 400 naming `required`, and no column definition is created. The failure is loud and actionable; it's never half-applied — backend
- [ ] **Both portal fields with one bad.** `probe PATCH /api/portals/$PORTAL '{"name":"ok name","lastOpened":"x"}'` → 400, and **neither** field changes. The valid `name` isn't applied on its own — backend
- [ ] **Retry storm after a 400.** Send the same malformed PATCH 50 times in a loop. Every one is a 400, then a valid request succeeds. No rate-limit lockout that a 400 wouldn't otherwise cause, and no 5xx — backend

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §1 unknown-key amplification | The 400 echoed every unknown key twice (message and `keys`): 4.1 MB of keys answered 12.3 MB, and the full list went into the error log line. The same probe on an array of bad items (`POST /api/file-uploads/presign`, 800 KB body of 400,000 bad entries) answered 51 MB, one issue per item. That route already returned all issues on `main`, but #745 routes about 40 more sites through `invalidPayload` and adds the key echo | med | fixed-in-PR: `invalidPayload` returns at most 20 issues with the total in `details.issueCount`. An unknown-key list is capped at 20 names, each clipped to 64 characters, and the message says "and N more". Re-probed: 717 B, 2.6 KB, and 509 B for a single 4 MB key name |
| §1 non-object JSON body (pre-existing, outside #745) | `--data '"x"'` / `'null'` → 400 `REQUEST_BODY_INVALID_JSON`, whose message is the body parser's own and quotes a fragment of the body. It only echoes the caller's own input back to them, and the warn log line leaves the message out | low | proposed waive: pre-existing, and the echo goes only to the sender |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got (status, code, message, `details`): · Repro (exact curl) · Identifiers (org / object ids):
