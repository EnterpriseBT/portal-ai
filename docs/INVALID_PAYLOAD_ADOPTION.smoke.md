# INVALID_PAYLOAD_ADOPTION — Smoke Suite

Manual smoke test for [#745](https://github.com/EnterpriseBT/portal-ai/issues/745). Every request that fails its schema now answers `400 <DOMAIN>_INVALID_PAYLOAD` (body) or `_INVALID_QUERY` (query), with the failing field in the message and every Zod issue in `details.issues`. The portal and pin PATCH bodies are schema-validated, and request bodies are `.strict()`. **Branch under test:** `chore/745-invalid-payload-adoption` (PR [#755](https://github.com/EnterpriseBT/portal-ai/pull/755)).

Run **§Preflight** once. After that the sections are independent.

- **§1 and §5** are browser flows that `/smoke-walk` can drive.
- **§2–§4 and §6** are API probes tagged `— backend`. Run them with `curl` against `:3001`, because the change is in the API's error contract, which a browser can't drive directly.
- **Strictness risk.** Strictness only bites if a real client sends a key the schema doesn't know, so §5's web flows are the main risk check. Watch the network panel for any `400 … Unrecognized key`.

---

## Preflight

### Environment

- [ ] `git checkout chore/745-invalid-payload-adoption && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The core contracts changed (strict bodies, `UpdatePortalBodySchema`, `UpdatePortalResultBodySchema`, `GrantListRequestQuerySchema`), and the API and web read core's dist. **No migration.**
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).

### Fixtures

- [ ] The e2e org is seeded and the owner session is fresh: `npm run --workspace @portalai/e2e e2e:seed` and `npm run --workspace @portalai/e2e e2e:auth`.
- [ ] Export the API base and the owner's bearer token, taken from the e2e storageState — backend:
  ```bash
  export API=http://localhost:3001
  export T=$(node -e 'const s=require("./packages/e2e/.auth/storageState.json");for(const o of s.origins)for(const i of o.localStorage)if(i.name.startsWith("@@auth0spajs@@")&&i.name.endsWith("::openid"))console.log(JSON.parse(i.value).body.access_token)')
  test -n "$T" && echo ok
  ```
- [ ] Define a probe helper that prints the status, code, message and the first issue path — backend:
  ```bash
  probe() { curl -s -o /tmp/r.json -w '%{http_code} ' -X "$1" "$API$2" -H "Authorization: Bearer $T" -H 'content-type: application/json' ${3:+-d "$3"}; jq -c '{code, message, path: .details.issues[0].path, n: (.details.issues|length)}' /tmp/r.json; }
  ```
- [ ] Pick ids from the e2e org — backend:
  ```bash
  export ENTITY=$(curl -s "$API/api/connector-entities?limit=1" -H "Authorization: Bearer $T" | jq -r '.payload.connectorEntities[0].id')
  export STATION=$(curl -s "$API/api/stations?limit=1" -H "Authorization: Bearer $T" | jq -r '.payload.stations[0].id')
  echo "$ENTITY $STATION"
  ```
  `PORTAL`, `PIN` and `GROUP` are captured in §1 and §5, from the ids the app shows in the URL or the network panel.

### Reset between runs

- [ ] No reset needed. The probes in §2–§4 are refused before any write. The portals, pins and groups that §1 and §5 create can be deleted in the app afterwards.

---

## §1 — Portal and pin rename still work, and bad bodies are refused (slice 2)

- [ ] In the web app (e2e org), open a station and create a portal. The portal opens. In the network panel, `POST /api/portals` → 201 and `PATCH /api/portals/<id>` (the open touch, `{lastOpened}`) → 200. Note the id as `PORTAL`.
- [ ] Send the message **"Show me 5 records from any entity as a table"**. `POST /api/portals/<id>/messages` → 2xx, and a reply streams in.
- [ ] Pin the result block under the name **"Smoke 745 pin"**. `POST /api/portal-results` → 201. Note the pin id as `PIN`.
- [ ] Rename the portal to **"  Smoke 745 portal  "** (with surrounding spaces). The header shows **"Smoke 745 portal"**, trimmed.
- [ ] Rename the pin to **"  Renamed pin  "**. The pin list shows **"Renamed pin"**, trimmed.
- [ ] `probe PATCH /api/portals/$PORTAL '{"lastOpened":"x"}'` → `400`, `code: PORTAL_INVALID_PAYLOAD`, the message starts `Invalid portal payload: lastOpened:`, and `path: ["lastOpened"]` — backend
- [ ] `probe PATCH /api/portals/$PORTAL '{"name":123,"lastOpened":1}'` → `400`, `path: ["name"]`. Reloading the portal still shows **"Smoke 745 portal"** (no partial update) — backend
- [ ] `probe PATCH /api/portal-results/$PIN '{"name":123}'` → `400`, `code: PORTAL_RESULT_INVALID_PAYLOAD`, the message starts `Invalid pin payload: name:` — backend
- [ ] `probe PATCH /api/portal-results/$PIN '{"name":"X","portalId":"p"}'` → `400`, the message ends `Unrecognized key: "portalId"` — backend

## §2 — One error shape on every domain (slices 3–5)

Each probe → `400`, the listed `code`, a message of the form `Invalid <thing> payload|query: <field>: …`, and `n ≥ 1`. No probe writes anything.

- [ ] `probe POST /api/organization/invitations '{}'` → `ORGANIZATION_INVALID_PAYLOAD`, the message names `email` — backend
- [ ] `probe POST /api/groups '{"name":""}'` → `ORGANIZATION_INVALID_PAYLOAD`, `path: ["name"]` — backend
- [ ] `probe POST /api/curated-views '{}'` → `CURATED_VIEW_INVALID_PAYLOAD` — backend
- [ ] `probe POST /api/connector-entities/$ENTITY/tags '{}'` → **`ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD`** (new code), `path: ["entityTagId"]` — backend
- [ ] `probe POST /api/entity-groups '{}'` → `ENTITY_GROUP_INVALID_PAYLOAD` — backend
- [ ] `probe POST /api/connector-instances/probe-endpoint-draft '{}'` → `REST_API_INVALID_CONFIG`, the message starts `Invalid probe-endpoint-draft body:`. The message and issues **echo no submitted values** (Zod 4 leaves input out) — backend
- [ ] `probe POST /api/file-uploads/presign '{"files":[]}'` → `FILE_UPLOAD_PARSE_INVALID_PAYLOAD`, `path: ["files"]` — backend
- [ ] `probe POST /api/toolpacks '{}'` → `TOOLPACK_INVALID_PAYLOAD`, naming the first missing field — backend

## §3 — Query failures use `_INVALID_QUERY` (review fix)

- [ ] `probe GET "/api/grants?resourceType=station"` → `400 GRANT_INVALID_QUERY`, `path: ["resourceId"]`. Before the fix this was a hand-built 400 with no issues — backend
- [ ] `probe GET "/api/grants?resourceType=planet&resourceId=x"` → `400 GRANT_INVALID_QUERY`, `path: ["resourceType"]` — backend
- [ ] `probe GET "/api/organization/usage/ledger?sortBy=portalId"` → `400 USAGE_LEDGER_INVALID_QUERY`, `path: ["sortBy"]`, with the allowed keys in the message — backend
- [ ] `probe GET "/api/organization/audit-log?sortBy=sourceIp"` → `400 AUDIT_LOG_INVALID_QUERY`, `path: ["sortBy"]` — backend
- [ ] `probe GET "/api/organization/usage/ledger?sortBy=units"` → `200` (an allowed key still works) — backend
- [ ] With `GROUP` from §5: `probe GET /api/entity-groups/$GROUP/resolve` → `400 ENTITY_GROUP_INVALID_QUERY`, `path: ["linkValue"]` — backend
- [ ] `probe GET "/api/entity-groups/$GROUP/members/overlap?targetLinkFieldMappingId=x"` → `400 ENTITY_GROUP_MEMBER_INVALID_QUERY`, `path: ["targetConnectorEntityId"]` — backend

## §4 — Strict bodies (slice 6)

- [ ] `probe POST /api/portals "{\"stationId\":\"$STATION\",\"stationID\":\"typo\"}"` → `400 PORTAL_INVALID_PAYLOAD`, message `Invalid portal payload: Unrecognized key: "stationID"`. **No portal is created** (the portal list count is unchanged) — backend
- [ ] `probe POST /api/groups '{"name":"Smoke 745","policyIds":[],"members":[]}'` → `400 ORGANIZATION_INVALID_PAYLOAD`, message `Invalid group payload: Unrecognized key: "members"`. No group is created — backend
- [ ] `probe PATCH /api/column-definitions/<any column-definition id> '{"label":"X","system":true}'` → `400`, `Unrecognized key: "system"`. The label is unchanged — backend
- [ ] `probe PATCH /api/column-definitions/<same id> '{"key":"new_key","label":"","type":"bogus"}'` → **`422 COLUMN_DEFINITION_KEY_IMMUTABLE`**, not a 400. The key check outranks the schema, so the status is unchanged from `main` — backend

## §5 — Web flows on now-strict routes still succeed (acceptance criterion 6)

For each flow, watch the network panel. The write returns 2xx and **no request comes back `400 … Unrecognized key`**.

- [ ] **Views:** create a curated view, edit its name, attach it to a station.
- [ ] **Entity groups:** create a group on an entity, then edit it. Note its id as `GROUP` for §3. Add a member and toggle **Primary**.
- [ ] **Tags:** create a tag, assign it to an entity, then edit the tag's name.
- [ ] **Records:** create a record on an entity, then edit one field.
- [ ] **Field mappings / column definitions:** create a column definition, edit its label, and add a field mapping to it.
- [ ] **Access (Settings → Access):** create a policy with one statement, a role that packages it, and a group with one member, then edit each once.
- [ ] **Members:** invite `smoke745+invite@example.com` (then revoke it).
- [ ] **Sharing:** share a station Read with the member identity. The share list (`GET /api/grants?resourceType=station&resourceId=…`) renders the new share.
- [ ] **Toolpacks:** register a custom toolpack (any HTTPS URL; a failed health check is fine), then edit its description.
- [ ] **File upload connector:** upload the sample CSV from the workflow's Sample files, walk to commit, and the import job starts.
- [ ] **REST API connector:** in the workflow, run **Preview** and **Probe & review** against a public JSON endpoint (e.g. `https://jsonplaceholder.typicode.com/posts`), click **Suggest transform**, then commit. Preview, probe, suggest-transform and the endpoint create all return 2xx.
- [ ] **Usage / audit:** Settings → Usage ledger and the audit log load and sort by each column header (a `sortBy` outside the allow-map can't be sent from the UI).
- [ ] **Agent RBAC tools** — manual: in a portal on a station with the access toolpack, prompt **"Create a group called Smoke 745 agents"**. The group is created, with no tool-input error in the tool-call panel. Agent behaviour varies, so a human judges the transcript.

## §6 — CI guards (slice 1 and the review fix)

- [ ] **Guard:** temporarily add `if (!parsed.success) { throw new ApiError(400, ApiCode.PORTAL_INVALID_PAYLOAD, "bad"); }` to any handler in `apps/api/src/routes/portal.router.ts`, then run `cd apps/api && npm run test:unit -- --testPathPattern invalid-request-code`. It **fails**, naming `portal.router.ts` and the line. Revert the edit, rerun, and it passes — backend
- [ ] **Strict sweep:** temporarily remove `.strict()` from `CreatePortalBodySchema`, then run `cd packages/core && npm run test:unit -- --testPathPattern strict-request-bodies`. `CreatePortalBodySchema refuses an unknown key` **fails**. Revert, rerun, and it passes — backend
- [ ] **No status change:** PR #755's **Integration Tests** check is green. That suite asserts every route's status, and the only expectation edits on the branch are codes, messages and the three "extra keys ignored" → 400 cases — backend

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got (status, code, message, `details.issues`): · Repro (exact curl or click path): · Identifiers (org / portal / pin / entity / group ids):
