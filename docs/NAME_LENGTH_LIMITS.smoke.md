# name_length_limits — Smoke Suite

Manual smoke test for [#801](https://github.com/EnterpriseBT/portal-ai/issues/801): user-authored names, labels and titles are capped at 120 characters, descriptions at 2000, and keys at 58. The API refuses longer values with a 400 naming the field, every form shows the limit inline, names the app generates are clipped, and data saved before the limits stays readable and editable. **Branch under test:** `fix/801-name-length-limits` (PR [#803](https://github.com/EnterpriseBT/portal-ai/pull/803)).

Run **§Preflight** once. Each section is independent after it. Steps tagged `— manual` need a human, and `— backend` steps run in a terminal; the rest are `/smoke-walk`-eligible. The expected copy is exact: "Name must be 120 characters or fewer", "Label must be 120 characters or fewer", "Description must be 2000 characters or fewer", "Key must be 58 characters or fewer", "Normalized key must be 58 characters or fewer", "Entity key must be 58 characters or fewer".

**Long values.** Paste them rather than typing. In the walk, `locator.fill("A".repeat(n))`; by hand, `node -e 'console.log("A".repeat(121))' | pbcopy` (or `xclip`).

---

## Preflight

### Environment

- [ ] `git checkout fix/801-name-length-limits && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/spreadsheet-parsing && npm run build --workspace=packages/core`: the limits live in core, and derived-key clipping lives in the parser, so web and API need both dists rebuilt. No migration.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`)
- [ ] Logged in to the seeded e2e org as owner (`npm run --workspace @portalai/e2e e2e:auth`, then `e2e:seed`)

### Fixtures

- [ ] — backend — Two CSVs for §3, written to the git-ignored results folder:
  ```bash
  mkdir -p packages/e2e/test-results/801
  node -e 'const f="packages/e2e/test-results/801/"+"Quarterly_regional_revenue_".repeat(6)+".csv"; require("fs").writeFileSync(f,"name,email,Total revenue for the quarter across every region and channel combined net of returns\nAda,ada@x.co,1\nBo,bo@x.co,2\nCy,cy@x.co,3\nDi,di@x.co,4\n"); console.log(f)'
  node -e 'require("fs").writeFileSync("packages/e2e/test-results/801/short.csv","name,amount\nA,1\nB,2\n")'
  ```
  The first file's name (without `.csv`) is 162 characters, and its third header is 89 (rows A1:C5). `short.csv` is a plain baseline (A1:B3).
- [ ] — backend — A station and a field mapping saved before the limits, for §4 (psql against the dev DB, e2e-fixture org):
  ```sql
  -- a copy of an existing station with a 500-character name
  INSERT INTO stations (id, organization_id, name, description, created, created_by)
  SELECT gen_random_uuid(), organization_id, repeat('L', 500), 'legacy', extract(epoch from now())*1000, created_by
  FROM stations WHERE organization_id = (SELECT id FROM organizations WHERE name = 'e2e-fixture') LIMIT 1
  RETURNING id;
  ```
  Note the returned id. The station has no tool packs, which §4 relies on.

### Reset between runs

- [ ] Delete the stations, tags, groups, column definitions and connectors §1–§5 create, from their list pages. Delete the legacy station from §Fixtures the same way.

---

## §1 — The #801 repro (AC1)

- [ ] `/stations` → **New Station** → paste 10,000 characters into **Name**, then click **Description**. "Name must be 120 characters or fewer" shows under Name, and Name has `aria-invalid="true"`. The field still holds all 10,000 characters (nothing truncated).
- [ ] Click **Create**. No `POST /api/stations` is sent, the dialog stays open, and focus moves to Name.
- [ ] Replace the name with exactly 120 characters and click **Create**. One `POST /api/stations` → **201**, and the dialog closes.
- [ ] **API boundary:** reopen **New Station**, type "Smoke 801 api", and before clicking Create, rewrite the request in flight (walk: `page.route("**/api/stations", r => r.continue({ postData: JSON.stringify({ ...JSON.parse(r.request().postData()), name: "A".repeat(121) }) }))`). The response is **400** `STATION_INVALID_PAYLOAD`, the dialog's `FormAlert` reads "Invalid station payload: name: Name must be 120 characters or fewer", and no station named with 121 A's exists.
- [ ] **Trim:** New Station with a name of three spaces → "Name is required" inline, no POST.

## §2 — Forms show the limit inline (AC3)

Each step: enter the over-limit value, move to another field (or click the primary), and expect the exact message under that field, `aria-invalid="true"` on it, and no write request.

- [ ] **New Station** → **Description**: paste 2,001 characters, fill a valid Name, click **Create**. "Description must be 2000 characters or fewer" shows, focus moves to Description, and nothing is sent.
- [ ] `/stations/<id>` → **Edit**: Name to 121 characters → **Save**. "Name must be 120 characters or fewer"; no PATCH.
- [ ] `/tags` → **Create Tag**: Name 121 characters → name message. Then a valid name with a 2,001-character Description → description message. No POST either time.
- [ ] `/entity-groups` → **Create Group**: Name 121 characters → name message; no POST.
- [ ] `/column-definitions` → **New**: Key of 59 lowercase letters → "Key must be 58 characters or fewer"; Label 121 characters → label message; no POST.
- [ ] A connector's page (e.g. Sandbox) → **Create Entity**: Label 121 → label message; Key 59 → key message; no POST.
- [ ] A column definition's page (`/column-definitions/<id>`, e.g. Name, once §3 has created a mapping to it) → **Create** (the field-mapping dialog): fill Source Field, Normalized Key 59 → "Normalized key must be 58 characters or fewer"; no POST.
- [ ] The same page → **Edit field mapping** on an existing mapping: Normalized Key 59 → the same message; no PATCH.
- [ ] A connector's page → **Edit** (rename): 121 characters → name message; no PATCH.
- [ ] `/portals/<id>` → **Rename**: 121 characters → name message; no PATCH.
- [ ] `/portal-results/<id>` → actions → **Rename**: 121 characters → name message; no PATCH.
- [ ] `/connectors` → **Catalog** → REST API → **Connect** → Basics: **Connector name** 121 (with a Base URL) → name message, and **Next** is disabled (enabled again at 120). Next → Endpoints → **Add endpoint**: **Entity key** 59 → key message, **Entity label** 121 → label message, and **Add** doesn't add the endpoint.
- [ ] Every field above accepts the boundary value (120 characters, 2000, or 58) without an error. Spot-check New Station Name at 120 and the column definition Key at 58.
- [ ] — manual — Settings → Access → **New policy / New role / New group** (needs a tier with custom RBAC): Name 121 → name message, Description 2,001 → description message. (The e2e fixture's tier hides these dialogs.)
- [ ] — manual — **Pin a result** from a portal chat (needs an agent run that produces a pinnable block): name 121 → "Name must be 120 characters or fewer", **not** "Name is required".

## §3 — Region editor and file-upload names (AC3, review fixes)

- [ ] `/connectors` → **Catalog** → File Upload → **Connect** → choose `packages/e2e/test-results/801/Quarterly_regional_revenue_…csv` → **Upload**. Drag over A1:C5 to draw a region → **+ Create new entity**. Type a 70-character label and leave Key alone: the derived key is at most 58 characters and doesn't end in `_`. Click **Create**: no key error.
- [ ] In the same dialog, type a Key of 58 letters plus a trailing space → no error (it is trimmed before measuring). A Key of 59 letters → "Key must be 58 characters or fewer".
- [ ] Back on the region, click **+ Add row axis** (without a header axis, Interpret finds no columns to bind), then **Interpret**. On the review step, open the 89-character header's binding: its derived **Normalized key** is at most 58 characters and doesn't end in `_`. Override it with 59 letters → "Normalized key must be 58 characters or fewer", and **Apply** is disabled.
- [ ] **Cancel** the popover and **Commit plan**. The import succeeds, and the new connector's name is the file name clipped to 120 characters, ending in "…" (Connectors list and the connector's page header).
- [ ] The committed entity's field mappings include the long header's mapping, with a key of at most 58 characters.
- [ ] Baseline: the same flow with `short.csv` (region A1:B3, **+ Add row axis**) → connector named "short", keys `name` and `amount`, unchanged from before.

## §4 — Data saved before the limits (AC7)

- [ ] Open the legacy station from §Fixtures (`/stations/<id>`). The page renders: the header shows the 500-character name (wrapping), with no error.
- [ ] **Edit** → change only the tool packs (leave the name) → **Save**. It saves: one PATCH → 200, and the request body has no `name` key.
- [ ] **Edit** → append "x" to the 500-character name → **Save**. "Name must be 120 characters or fewer" inline; no PATCH.
- [ ] — backend — Give an existing field mapping a legacy key: `UPDATE field_mappings SET normalized_key = repeat('k', 80) WHERE id = '<a mapping id>';`. Then in the app, **Edit field mapping** on it, change only Source Field → **Save**. It saves, and the PATCH body has no `normalizedKey`. Restore the key afterwards.

## §5 — Agent tools (AC4) — manual

The agent's choices aren't deterministic, so a human judges the transcript.

- [ ] — manual — In a portal on a station with write tools, ask: "Create a connector entity with key `" + 59 × "k" + "` and label `Long key test`". The tool result is a validation error naming "Key must be 58 characters or fewer", nothing is created, and the agent relays the error.
- [ ] — manual — Ask for a chart titled with 121 characters. The `visualize_d3` input is refused with "Title must be 120 characters or fewer" (the agent may retry with a shorter title).
- [ ] — manual — Ask the agent to create a field mapping whose key is 59 characters. It's refused with the normalized-key message.

## §6 — Static and backend guarantees (AC2, AC5, AC8) — backend

- [ ] — backend — `npm run test:unit --workspace=@portalai/core -- --testPathPattern 'name-length.guard|text-limits'` → green. The guard finds at least 30 guarded fields.
- [ ] — backend — Add `foo: z.object({ name: z.string() })` to any exported `*BodySchema` locally and rerun the guard. It fails naming `<Schema>.foo.name`. Revert.
- [ ] — backend — `npm run test:unit --workspace=@portalai/api -- --testPathPattern wide-table-reconciler.sanitize` → green (≤ 63 bytes, distinct long keys, legacy truncated names avoided).
- [ ] — backend — `npm run lint && npm run type-check && npm run build` at the root, and `npm run format:check` in each package → clean.

## §7 — Error & edge cases

- [ ] **Plan PATCH:** file-upload plans can't be edited in the UI, so call the API directly (walk: reuse the `Authorization` header from one of the app's own requests with `page.request`). `GET /api/connector-instances/<§3 connector>/layout-plan`, then `PATCH …/layout-plan/<planId>` with `{ "regions": [<region 0 with targetEntityDefinitionId set to 59 characters>] }` → 400 `LAYOUT_PLAN_INVALID_PAYLOAD` with "Entity key must be 58 characters or fewer", and the stored plan is unchanged. A PATCH that sends only `confidence` on that plan still succeeds.
- [ ] — backend — **Commit a stored plan by id:** store a plan whose region target is 59 characters (`UPDATE connector_instance_layout_plans SET plan = jsonb_set(plan, '{regions,0,targetEntityDefinitionId}', to_jsonb(repeat('e',59))) WHERE id = '<planId>';`), then `POST /api/connector-instances/<id>/layout-plan/<planId>/commit` with the connector's own workbook source: `{ "uploadSessionId": "<the session from its layout_plan_commit job's metadata.workbookSource>" }` for a file upload (`{ "connectorInstanceId": "<id>" }` for a cloud connector) → 400 "Invalid plan: Entity key must be 58 characters or fewer", and no `layout_plan_commit` job row is added. Restore the plan's target afterwards.
- [ ] — backend — `npm run db:create-org --workspace=@portalai/api -- --owner-email <you> --name "$(node -e 'console.log("A".repeat(121))')"` → fails with "Usage: db:create-org -- --name: Name must be 120 characters or fewer" and creates nothing. A name of three spaces → the usage error.
- [ ] — manual — **Google Sheets / Microsoft 365 Excel:** connect an account (real vendor login). The pending connector's name is "Google Sheets (<email>)" / "Microsoft 365 Excel (<upn>)", clipped to 120 characters with "…" if longer. Commit a sheet whose title is over 120 characters: the import succeeds and the connector is named with the clipped title.
- [ ] — manual — **Stored plans still replay (AC6):** on an existing Google Sheets or Excel connector whose sheet has a header longer than 58 characters, run **Sync**. It completes, and its records match the sheet.

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/connector/entity/plan ids):
