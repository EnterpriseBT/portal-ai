# OBJECT_PROVENANCE — Smoke Suite

Manual smoke test for [#641](https://github.com/EnterpriseBT/portal-ai/issues/641). Objects an agent creates in a portal session are owned by the prompting user and record the session as `sourcePortalId`. They show a "Created in a portal session" chip, and the system principal stays on platform seeds. **Branch under test:** `feat/641-object-provenance` (PR [#823](https://github.com/EnterpriseBT/portal-ai/pull/823)).

Run Preflight once. After that, every section is independent. A step tagged `— backend` is a DB, API or CLI check outside the browser, and a step tagged `— manual` needs a human.

## Preflight

### Environment

- [ ] `git checkout feat/641-object-provenance && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The core models gained `sourcePortalId` and `isSessionGenerated`, so the API and web need the rebuilt dist.
- [ ] `cd apps/api && npm run db:migrate`. Migration **`0127_object-source-portal-id`** adds a nullable `source_portal_id text` to six tables. `npm run dev` doesn't migrate.
- [ ] `npm run dev` boots cleanly (web :3000, API :3001). The local API has an `ANTHROPIC_API_KEY`, because the agent turns below are real model calls.
- [ ] Playwright e2e sessions exist (`npm run --workspace @portalai/e2e e2e:auth:all`) and the `e2e-fixture` org is seeded (`e2e:seed`).

### Fixtures

- [ ] Put the fixture org on a tier with custom RBAC, so the agent's role, policy and group tools aren't refused: `npx portalai org set-tier <e2e-fixture org id> enterprise --env local --yes`. Note the org id and the owner's user id: `select id from users where email = '<E2E_AUTH0_USERNAME>'`.
- [ ] Use the fixture's **My Station** (all built-in toolpacks enabled by `--all-toolpacks`) and its **Sandbox** connector, which is write-enabled.
- [ ] **Attach at least one curated view on a Sandbox entity to My Station.** Since #599 a station's write capability comes from its attached views, and with none the agent's entity-write tools are dropped (the agent then wrongly blames the plan). Walking §3 first provides `smoke_manual`: create a view on it and attach it (Station → edit → Views).
- [ ] Start **one new portal** on My Station as the owner and note its id (`/portals/<id>`). Every agent prompt below runs in that portal, which is called **P** below.

### Reset between runs

- [ ] Delete the smoke objects by name: entities `smoke_widgets` / `smoke_manual` / `smoke_widget_copies`; policy, role and group `Smoke Agent *` / `Smoke UI *`. Use a fresh portal for each run.

## §1 — Migration and model

- [ ] `\d connector_entities`, `field_mappings`, `entity_records`, `roles`, `permission_policies` and `groups` each show `source_portal_id | text`: nullable, no default, no FK. — backend
- [ ] Rows that existed before the migration read `source_portal_id IS NULL`: `select count(*) from connector_entities where source_portal_id is not null` returns `0` before any agent run below. — backend

## §2 — Agent-created entity, field mapping and record

- [ ] In P, prompt: **"Create an entity called smoke_widgets (label Smoke Widgets) on the Sandbox connector, map a text field name and a text field sku, then add one record with name Gear and sku G-1."** The agent reports the entity, two mappings and one record created.
- [ ] Open **Entities → Smoke Widgets**. Its header metadata shows **Provenance: Created in a portal session**.
- [ ] On the **Sandbox connector page** (`/connectors/<sandbox id>`, entity cards), the Smoke Widgets card shows the "Created in a portal session" chip. Expanding it, the `name` and `sku` field-mapping rows show the chip in the **Provenance** column.
- [ ] Open the Gear record. Its metadata shows **Origin `portal`** and **Provenance: Created in a portal session**.
- [ ] `GET /api/connector-entities/<smoke_widgets id>` returns `sourcePortalId` equal to **P's id**. `GET /api/field-mappings/<id>` and `GET …/records/<Gear id>` return the same. — backend
- [ ] DB check: `select created_by, source_portal_id from connector_entities where key = 'smoke_widgets'` shows the **owner's user id** and P's id, and **not** `SYSTEM`. The field-mapping and record rows read the same. — backend

## §3 — Hand-created twins carry no marker

- [ ] Through the UI, create an entity `smoke_manual` on Sandbox with a text mapping `name`, and add one record by hand.
- [ ] The Smoke Manual header has **no** Provenance row. Its card and mapping rows show **no** chip, and the record's metadata has no Provenance row.
- [ ] Its API payloads return `sourcePortalId: null`, and the DB `source_portal_id` is NULL with `created_by` = the owner. — backend

## §4 — Agent-created policy, role and group

- [ ] In P, prompt: **"Create a policy called Smoke Agent Policy that allows reading stations, a role called Smoke Agent Role with that policy, and a group called Smoke Agent Group with that policy."** The agent reports all three created, with no `TOOL_PERMISSION_DENIED`.
- [ ] **Settings → Access**:
  - On **Policies**, Smoke Agent Policy shows the "Created in a portal session" chip, and system policies show only the `system` chip.
  - On **Roles**, Smoke Agent Role shows the chip.
  - On **Groups**, Smoke Agent Group shows the chip.
- [ ] Through the same UI, create **Smoke UI Policy** (read stations), **Smoke UI Role** and **Smoke UI Group**. None of their rows shows the chip.
- [ ] `GET /api/policies`, `/api/roles` and `/api/groups` list the three agent rows with `sourcePortalId` equal to P's id and the three UI rows with `null`. The DB `created_by` is the owner for all six. — backend
- [ ] Rename Smoke Agent Role in the UI. Its row still shows the chip, and its `source_portal_id` is unchanged. Editing doesn't clear provenance.

## §5 — Ownership is unchanged

- [ ] As the owner, Smoke Widgets' header **More actions** menu offers exactly what Smoke Manual's does (today: **Delete**), gated by its own `capabilities`.
- [ ] As the **admin** (`e2e:use admin`, switched into e2e-fixture), open Smoke Widgets. The chip shows for this reader too.
- [ ] `GET /api/connector-entities/<smoke_widgets id>` returns the same `capabilities` for the owner as Smoke Manual does. — backend

## §6 — Bulk transform records and the job actor

- [ ] In P, prompt: **"Create an entity smoke_widget_copies with a text column name and sku as its key. Then use the bulk transform tool (transform_entity_records), not single record creates, to write each Smoke Widgets row's name into it keyed by sku. Run it as a job."** The agent creates an empty target and runs a transform job, and the job completes. The target must start empty, or the transform updates existing rows instead of inserting.
- [ ] In the DB, the target's records read `origin = 'portal'`, `source_portal_id` = P's id and `created_by` = the owner. No row reads `created_by = 'SYSTEM'`: `select count(*) from entity_records where created_by = 'SYSTEM'` returns `0`. — backend
- [ ] The job row's `created_by` is the owner. — backend

## §7 — Pins and edge cases

- [ ] Pin one of the agent's answers in P, then open **Pinned results** and the pin's detail. Neither shows a "Created in a portal session" chip (pins get none by design).
- [ ] **Delete portal P.**
  - Smoke Widgets still shows the chip.
  - Its `source_portal_id` still holds P's id (no FK, no cascade).
  - The pin's detail now reads **Source: Portal deleted**.
- [ ] **Legacy record:** `update entity_records set source_portal_id = null where id = '<Gear id>'`, keeping `origin = 'portal'`. Reload the Gear record. It **still** shows the chip, through the `origin = 'portal'` fallback.
- [ ] `npm run test:unit -- --testPathPattern system-principal` (from `apps/api`) passes: the guard holds on this tree. — backend
- [ ] Read CLAUDE.md → **Ownership & provenance (#641)**, the copilot mirror, and `docs/PROD_PROVISIONING.runbook.md` (the `SYSTEM_ID` note). Check they describe what you just observed. — manual

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/portal/entity/role ids):
