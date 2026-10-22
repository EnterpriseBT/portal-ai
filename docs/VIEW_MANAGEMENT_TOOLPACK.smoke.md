# view-management-toolpack — Smoke Suite

Manual smoke test for [#645](https://github.com/EnterpriseBT/portal-ai/issues/645): the `view_management` ("Curated Views") toolpack. It covers `curated_view_list`, `get`, `create`, `update`, `delete` and `share`, plus the shared `member_list`, all running through the real permission, tier and cost gates. It also covers the "Created in a portal session" chip on the Views pages. **Branch under test:** `feat/645-view-management-toolpack` (PR [#844](https://github.com/EnterpriseBT/portal-ai/pull/844)).

Run **§Preflight** once; each section after it is independent. Unmarked steps can be walked in a browser by `/smoke-walk`. Steps tagged `— manual` need a human. Steps tagged `— backend` are checked with `db:studio`, `psql` or `curl` against `:3001`.

Filing bugs: open a `Bug` issue against `EnterpriseBT/portal-ai` linking this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/645-view-management-toolpack && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The core registries, contract and model changed, and the API dev server needs the rebuilt dist. Touch an `apps/api/src` file afterwards so nodemon reloads core.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — `0131_add-curated-view-source-portal-id.sql` adds `curated_views.source_portal_id` (nullable, no backfill). `npm run dev` seeds but does not migrate.
- [ ] `npx portalops tier apply --env local --yes` adds `view_management` to the standard and plus tier rows (pro and enterprise already take every pack). This needs a live Stripe key in `packages/devops-cli/.env`. — backend
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] e2e sessions are fresh for owner, admin and member: `npm run --workspace @portalai/e2e e2e:auth` per identity, then copy `storageState.json` to `owner.storageState.json`.

### Fixtures

| Alias | What | Used by |
|---|---|---|
| **org** | The `e2e-fixture` org (`npm run --workspace @portalai/e2e e2e:seed`, plus the demo seed) | all |
| **owner / admin / member** | The three seeded identities. The default member can't read any entity, so it can't create views (see memory: e2e member fixture limits). | §1–§6 |
| **accounts** | A readable entity with at least a `name` column and a categorical column (e.g. `region`). Use one of the seeded demo entities. | §1–§5 |
| **station S** | A new station with the `view_management` and `data_query` packs and **no views attached** | §1–§6 |
| **station R** | The same station with `rbac_management` **and** `view_management` enabled | §6 |

Record the org's tier before §4 (`npx portalai org get <orgId> --env local`).

### Reset between runs

- [ ] Delete the views the walk created (Views page → each row → Delete), or use `curated_view_delete` in a session.
- [ ] Restore the org's original tier after §4 (`npx portalai org set-tier <orgId> <slug> --env local --yes`).

---

## §1 — Create, edit and see a view (slices 1–5)

- [ ] As **owner**, open a portal session on **station S**. Prompt: **"Create a view of accounts called 'North-east accounts' showing only name and region, filtered to region NE."**
- [ ] Before creating, the agent calls `curated_view_entity_list` (station S has no views yet, so `station_context` lists no entities) and takes the entity id and column keys from it. No id is given in the prompt.
- [ ] The tool panel shows `curated_view_create`, with `columns: ["name","region"]` (keys, not ids) and a structured `filter`. The result is `{ success: true, curatedView: {...} }`.
- [ ] Prompt: **"Add the <third column> column to that view and change the filter to region SE."** The agent calls `curated_view_update` with `columns` and `filter`, and the result shows both changes.
- [ ] Prompt: **"Show me the details of that view."** `curated_view_get` returns `columns` as `{ fieldMappingId, key }` pairs, plus the filter and `grants` (the owner can share).
- [ ] Open `/curated-views`. The new view is listed with the **"Created in a portal session"** chip. Open it: the detail page's MetadataList has a **Provenance** item with the same chip.
- [ ] Open a view created on the Views page (not by the agent). It has no chip and no Provenance item.
- [ ] `db:studio` → `curated_views`: the agent's row has `source_portal_id` = the session's portal id and `created_by` = the owner's user id. The UI-created row has `source_portal_id` null. — backend
- [ ] Edit **station S** on its page and attach the new view. A new session prompt, **"How many records does the North-east accounts view have?"**, resolves through the view.

## §2 — Permission outcomes (spec acceptance 2–3)

- [ ] As **member**, in a session on a station with `view_management` (create one the member owns), prompt: **"Create a view of accounts called 'Member view'."** The tool result is `TOOL_PERMISSION_DENIED`, and the agent relays it without retrying.
- [ ] As **owner**, create a view the member has no grant on. As **member**, prompt **"Show me view <id>"** with its id. `curated_view_get` returns `TOOL_TARGET_NOT_FOUND`. Repeat with "rename it", "delete it" and "share it with the team": every one returns `TOOL_TARGET_NOT_FOUND`.
- [ ] As **owner**, share that view with **member** at `read`. As **member**, prompt "rename it", "delete it" and "share it with the team". Each returns `TOOL_PERMISSION_DENIED`.
- [ ] As **member**, prompt: **"List the curated views."** `curated_view_list` returns only views the member can read (the shared one, not the unshared one), and `filter`/`filterSql` are absent on rows the member can't write.
- [ ] As **member**, `curated_view_get` on the shared view returns no `filter`, no `filterSql` and no `grants`.

## §3 — Column-name probing is closed (review fix 80605f6e) — backend

- [ ] As **owner**, give **admin** `read-write` on a view whose entity admin **cannot** read. (Use a custom policy or revoke admin's entity read in the Access settings; skip this step if the fixture can't produce it, and record why.)
- [ ] As **admin**, `curated_view_update` with `columns: ["no_such_column"]`, then with a real column key. Both return `TOOL_PERMISSION_DENIED`, not a 400 naming the unknown key.
- [ ] Repeat with a `filter` naming an unknown field, then a real field. Both are refused the same way.

## §4 — SQL filter follows the tier (spec acceptance 4)

- [ ] Set the org to a tier **without** `advancedViewFilters`: `npx portalai org set-tier <orgId> standard --env local --yes`. — backend
- [ ] As **owner**, prompt: **"Create a view of accounts filtered with SQL `region = 'NE'`."** The tool result is `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED` (not `TOOL_PERMISSION_DENIED`). The agent offers the structured filter instead and does not retry the SQL.
- [ ] Accept the offer. The structured-filter create succeeds on the same tier.
- [ ] Set the org to `pro` (`advancedViewFilters: true`) and repeat the SQL prompt. The create succeeds with `filterSql` set. — backend for the tier switch
- [ ] Prompt: **"Create a view with both a structured filter and a SQL filter."** The agent picks one, or the tool returns `CURATED_VIEW_INVALID_PAYLOAD` "Use either the builder filter or a SQL filter, not both" (never a "circular structure" error). No view with both is written.

## §5 — Delete and share (spec acceptance 5–6)

- [ ] As **owner**, attach a tool-created view to **station S** on the station page, and share it with **member** at `read`.
- [ ] Prompt: **"Delete that view."** The result reports `cascaded` with `stationViews: 1` and `grants: 1`. The view is gone from `/curated-views`, and **station S**'s page no longer lists it.
- [ ] Create a fresh view. Prompt: **"Share this view with <member's display name>, read only."** The agent calls `member_list` to resolve the person, then `curated_view_share` with `grantee: { type: "user", userId }` and `access: "read"`.
- [ ] Prompt with a name that matches two members, or no members. The agent asks which one, or says no one matches, rather than guessing. — manual (needs a second member with a similar name)
- [ ] Prompt: **"Make that read-write."** The share's access changes, and the view page's Share dialog shows member at read-write.
- [ ] Prompt: **"Share it with the whole org."** `curated_view_share` is called with `grantee: { type: "team" }`, and the Share dialog lists the team.
- [ ] Prompt: **"Stop sharing it with <member>."** `curated_view_share` with `access: "none"` returns `{ success: true, revoked: true }`, and the Share dialog no longer lists member.
- [ ] Repeat the revoke. It returns `revoked: false` with no error.
- [ ] Prompt: **"Share it with jane@example.com."** The agent doesn't pass an email: it looks the person up with `member_list`, or says it can't share by email.

## §6 — Pack wiring (spec acceptance 7–9)

- [ ] On the station edit dialog, enable both **Access** (`rbac_management`) and **Curated Views** (`view_management`). No tool-collision warning appears, and the Curated Views pack card shows the same Layers icon as the Views menu item.
- [ ] In a session on **station R**, the tool panel offers `member_list` once. — backend: `GET /api/stations/<R>` toolpacks, or the session's tool list in the API log
- [ ] Register a custom toolpack exposing a tool named `member_list` and enable it alongside `view_management`. The collision warning **does** appear.
- [ ] Make **station S** read-only (or open a session as a read-only caller). The six `curated_view_*` tools and `member_list` are still offered.
- [ ] For each tier (`standard`, `plus`, `pro`, `enterprise`), enabling Curated Views on a station isn't upsold or blocked. — backend for the tier switches
- [ ] Prompt: **"Attach the North-east accounts view to this station."** The agent says it can't attach views and points to the station's edit page. No tool call changes the station.

## §7 — Error and edge cases

- [ ] Prompt: **"Create a view with a column called 'does_not_exist'."** The tool returns a 400 code naming the unknown key (the owner can read the entity), and nothing is written.
- [ ] Prompt: **"Update the view"** with no change. The agent asks what to change, or the tool returns `CURATED_VIEW_INVALID_PAYLOAD` "Give at least one field to change". Nothing is written.
- [ ] Prompt a duplicate key: **"Create another view with key `ne_accounts`."** The result keeps its 409 code and the agent relays it.
- [ ] `curl` `GET /api/curated-views/<id>` with the owner's token. The payload carries `columns: [{ fieldMappingId, key }]`, and `/api/docs` shows the `CuratedViewColumn` component. — backend
- [ ] Each view tool shows a phase label in the session's live status pill while it runs ("Listing views", "Reading the view", "Creating the view", "Updating the view", "Deleting the view", "Sharing the view"). — manual (it's brief, so a human judges it)

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (prompt, identity, station): · Identifiers (org / station / portal / view / grant ids):
