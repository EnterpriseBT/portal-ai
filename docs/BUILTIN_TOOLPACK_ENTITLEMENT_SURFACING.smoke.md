# builtin-toolpack-entitlement-surfacing — Smoke Suite

Manual smoke test for [#284](https://github.com/EnterpriseBT/portal-ai/issues/284) — surfacing the built-in toolpack entitlement axis #214 enforced but never showed. Covers the five display surfaces (both station pickers, `/toolpacks` badge + modal, four attached-pack chip surfaces), the shared `/settings?tab=billing` upgrade path, the `403 STATION_TOOLPACK_NOT_ENTITLED` write guard over newly-added slugs, and the agent's entitlement-driven capability surface (effective vs. unentitled packs in the prompt and in `station_context`).

**Branch under test:** `feat/builtin-toolpack-entitlement-surfacing` (PR [#299](https://github.com/EnterpriseBT/portal-ai/pull/299)).

Run **§Preflight** once before any section. §1–§10 are independent after preflight, but §6 and §8 flip your org's tier — finish each before moving on, and §Reset returns you to `standard`.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/builtin-toolpack-entitlement-surfacing && git pull --ff-only`
- [ ] `npm install` — **no migration on this branch.** No schema change: `tiers.builtin_toolpacks` and `station_toolpacks` already exist and neither gained a column. If `npm run db:migrate` reports pending migrations, they came from `main`, not here.
- [ ] `npm run build --workspace=packages/core` — `SelectOption` gained `disabledReason` and the web imports `BuiltinToolpackSlugSchema`; the API and web need the rebuilt core dist.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Auth0 dev tenant login lands on the dashboard.
- [ ] `apps/web/src/routeTree.gen.ts` is **unchanged** vs. `main` (`git diff main -- apps/web/src/routeTree.gen.ts` is empty). `/settings` gained `validateSearch`, which does *not* regenerate the tree — a diff here means something else regenerated it.

### Tier fixtures

The whole ticket is about a tier that entitles *some* built-in packs. Two commands set that up (`portalops` owns the catalog, `portalai` owns the org's tier — per the CLI domain boundary):

- [ ] `DATABASE_URL=… npx portalops tier apply --env local --yes` — seeds/refreshes the tier catalog rows so `standard`, `plus`, `pro` exist locally.
- [ ] Confirm the catalog's split, which is what every section below leans on:
      `npm run db:studio` (from `apps/api/`) → `tiers` table. `standard.builtin_toolpacks` should be `["data_query","web_search"]`; `pro` should carry all seven slugs.
- [ ] Note your org id: `npx portalai org list --env local --json` (or Settings → Organization).
- [ ] Put the org on `standard`: `npx portalai org set-tier <orgId> standard --env local --yes`

> **Tier cache — read this before every tier flip.** `TierService` caches the resolved policy per slug for **60 seconds** (`CACHE_TTL_MS`). After any `set-tier`, either wait ~60s or restart the API before expecting the app to see it. Every "flip the tier" step below assumes you did one of the two.

> **Stripe guard.** If your local org has a live Stripe subscription, `set-tier` refuses with exit 9 (`ADMIN_CONFLICT`) — that's #259 working. Either use an org with no subscription or pass `--allow-stripe-desync` consciously for the duration of this walk.

### Station fixtures

| Alias | Shape | Used by |
|---|---|---|
| **entitled-station** | A station with **only** `data_query` + `web_search` enabled (both entitled on `standard`). Any connector instance attached. | §1, §4, §7 |
| **legacy-station** | A station that **already carries `entity_management`** (and ideally `visualize`) while your org is on `standard`. Create it *while the org is on `pro`*, then flip back to `standard` — that's the downgrade state the whole ticket exists for. | §2, §4, §6, §7, §8 |

- [ ] Build **legacy-station**: `npx portalai org set-tier <orgId> pro --env local --yes` → wait/restart → create a station with `data_query`, `entity_management`, and `visualize` → `npx portalai org set-tier <orgId> standard --env local --yes` → wait/restart.
- [ ] Attach a writable connector instance to **legacy-station** (the agent's entity-creation path needs one to be a fair test in §7).

### Reset between runs

- [ ] `npx portalai org set-tier <orgId> standard --env local --yes` returns you to the baseline; wait ~60s or restart the API.
- [ ] No data reset needed — nothing in this ticket writes or deletes station/pack rows except the station edits you make yourself. A downgrade is non-destructive by design (that's §8).

---

## §1 — Fail-open behavior (the UI never forbids what the server would allow)

The client's entitlement read is an honesty affordance, not a gate. A stale or failed `usage()` must never disable a legitimate action.

- [ ] With the org on `standard`, open Stations. In DevTools → Network, block or fail `GET /api/organization/usage` (right-click → Block request URL, then reload).
- [ ] Open **Create Station**: every built-in pack is **selectable**, no "Not included in your plan" reason anywhere. (Fail open — the server 403 is the real gate.)
- [ ] `/toolpacks` with the same request blocked: **no** "Inactive on your plan" badges on built-in rows.
- [ ] Unblock the request, reload: the badges and disabled options come back.

---

## §2 — Station pickers (Create + Edit)

- [ ] **Create Station** on a `standard` org: the Tool Packs dropdown lists **all seven** built-ins. `entity_management`, `statistics`, `regression`, `financial`, `visualize` are visibly **greyed out and unclickable**, each with **"Not included in your plan"** under the label. `data_query` and `web_search` are normal.
- [ ] Clicking a greyed-out option does nothing — no chip is added, the dropdown stays open.
- [ ] Keyboard: type `entity` to filter to the disabled option, press `↓` then `Enter` — still nothing selected.
- [ ] Custom (`org:<uuid>`) packs, if you have any registered, are **unaffected** by this axis (they follow #214's own boolean).
- [ ] **Edit Station** on **legacy-station**: the same options are disabled with the same reason, *and* the already-attached `entity_management` / `visualize` chips are **still present in the field**.
- [ ] Delete the `entity_management` chip in Edit → it disappears and the form accepts it (removing an unentitled pack is always allowed). **Don't save yet** — §6 uses this state. Cancel out.

---

## §3 — `/toolpacks` list + metadata modal

- [ ] `/toolpacks` on a `standard` org: `Entity Management`, `Statistics`, `Regression`, `Financial`, `Visualize` rows each carry an amber **"Inactive on your plan"** chip beside their `Built-in` chip. `Data Query` and `Web Search` carry none.
- [ ] Click an **unentitled** built-in row → the metadata modal opens with an info alert reading *"This tool pack isn't included in your plan, so its tools are unavailable in portal sessions."* plus a **View plans** link.
- [ ] The same modal still lists the pack's tools and parameter schemas (it documents what the pack *does*; the alert states it's unavailable).
- [ ] Click an **entitled** built-in row (`Data Query`) → modal is exactly as before: no alert, no link.
- [ ] If you have a custom toolpack registered, its badge/modal behavior is unchanged from #214.

---

## §4 — Attached-pack chips (all four surfaces)

An unentitled pack that's already attached must read as inert everywhere, without disappearing. Look for: **dimmed + dashed border**, pack still named.

- [ ] **Station detail** (`/stations/<legacy-station>`) → Tool Packs row: `entity_management` and `visualize` chips are dimmed/dashed; `data_query` is normal.
- [ ] Hover a dimmed chip → tooltip: *"This tool pack isn't included in your plan, so its tools are unavailable in portal sessions."*
- [ ] Click a dimmed chip → the metadata modal opens and shows the §3 alert (the chip stays clickable; it's inert as a *capability*, not as a link).
- [ ] **Portal header** — open a portal on **legacy-station**, expand the header meta: same dimmed treatment on the same chips.
- [ ] **Station list** (`/stations`) → legacy-station's card: same.
- [ ] **Dashboard default-station card** — make legacy-station the default (`Set as default` on `/stations`), then reload the dashboard: same.
- [ ] On **entitled-station**, every chip on all four surfaces is normal — no dimming, no tooltip.

---

## §5 — Upgrade path + role-agnostic copy

- [ ] From any unentitled affordance, click **View plans** → you land on `/settings?tab=billing` with the **Subscription & Billing** tab already open (not Profile).
- [ ] Reload `/settings?tab=billing` directly → still opens on Subscription & Billing.
- [ ] `/settings` with no param → opens on **Profile**. `/settings?tab=not-a-tab` → also Profile (unknown values are dropped, not errors).
- [ ] `/settings?tab=billing` still honors the checkout return: `/settings?billing=success&tab=billing` shows the success toast **and** opens the billing tab.
- [ ] **Role-agnostic copy:** sign in as a **non-owner member** of the same org (or invite a second user). Every string in §2–§4 is byte-identical to what the owner sees — same reason, same tooltip, same **View plans** link. Nothing is hidden or reworded for non-owners.
- [ ] The owner-only gate still lives *on* the billing tab: a non-owner sees the tier cards but the manage/subscribe action is disabled with the existing "Only the organization owner can manage billing" copy.

---

## §6 — Server enforcement (`403 STATION_TOOLPACK_NOT_ENTITLED`)

The UI is an affordance; this is the gate. Use `curl` (or the UI where noted) with your org on **`standard`**.

Grab a token from DevTools (Application → Local Storage → the Auth0 access token) or copy a request as cURL from the Network tab.

- [ ] **POST rejects a new unentitled pack:**
      `curl -si -X POST localhost:3001/api/stations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Blocked","toolPacks":["data_query","entity_management"]}'`
      → **403**, body code `STATION_TOOLPACK_NOT_ENTITLED`, message naming `entity_management`.
- [ ] **Nothing persisted:** `db:studio` → `stations` has no `Blocked` row, and `station_toolpacks` gained nothing. (The guard runs before the insert — a denial must not leave an orphan station.)
- [ ] **The API log carries the denial** with `organizationId`, `tier`, and `denied: ["entity_management"]` — this is what support reads instead of reproducing the failure.
- [ ] **POST with no `toolPacks` succeeds:** same curl with `-d '{"name":"Defaults OK"}'` → **201**, and `station_toolpacks` shows exactly one row, `builtin_slug = data_query` (the default is entitled on every tier).
- [ ] **PATCH adding an unentitled pack rejects:** on **entitled-station**,
      `curl -si -X PATCH localhost:3001/api/stations/<id> -H … -d '{"toolPacks":["data_query","visualize"]}'` → **403**, same code; `station_toolpacks` for that station is unchanged.
- [ ] **Rename-only PATCH on legacy-station succeeds:** `-d '{"name":"Renamed Anyway"}'` → **200**. This is the criterion that makes a downgrade survivable — the station stays editable even while carrying packs the plan excludes.
- [ ] **Re-sending an already-attached unentitled pack succeeds:** on legacy-station, `-d '{"toolPacks":["data_query","entity_management","visualize"]}'` (exactly what's already persisted) → **200**. Nothing is newly added, so nothing is denied.
- [ ] **Remove-then-re-add:** on legacy-station, PATCH `-d '{"toolPacks":["data_query"]}'` → **200** (removal always allowed). Then PATCH `-d '{"toolPacks":["data_query","entity_management"]}'` → **403** (re-adding is a new attach). *Re-attach `entity_management` + `visualize` from a `pro` tier afterwards if you want legacy-station back for §7/§8.*
- [ ] **Swagger documents it:** `http://localhost:3001/api-docs` → both `POST /api/stations` and `PATCH /api/stations/{id}` list a **403** response describing the plan exclusion.
- [ ] **UI path:** in Edit Station on entitled-station, there is no way to *reach* this 403 through the picker (the option is disabled) — confirm the server error surfaces readably if you do force it (e.g. re-enable the option in DevTools, save): the dialog stays open with the error, it does not close silently.

---

## §7 — The agent (the reported bug)

Open a portal on **legacy-station** (`standard` tier, so `entity_management` + `visualize` are configured-but-unentitled).

- [ ] Prompt: **"Create an entity called scrabble_scores with a word and a score column."**
      The reply **names the plan limit** — that record creation isn't included in the organization's current plan — and points at **Settings → Subscription & Billing**. It must **not** read as a missing product capability ("I don't have a tool for that", "this would typically be done through the UI").
- [ ] Prompt: **"Chart the top 10 rows of <entity> as a bar chart."**
      The agent says charting isn't included in the plan. It must **not** silently answer with a table presented as the visualization you asked for, and must not claim it rendered a chart.
- [ ] Prompt: **"What can you do here?"**
      The answer enumerates **only** querying/reading data and web search. It must not offer charting, statistical tests, forecasting/regression, financial math, or record creation.
- [ ] Prompt: **"Run a t-test on <numeric column>."** → not offered / named as unavailable (the `statistics` pack isn't on `standard`).
- [ ] The agent calls **`station_context`** at some point; inspect the tool-result panel for a `toolPacks` section:
      `{ "effective": ["data_query","web_search"], "unentitled": ["entity_management","visualize"] }`.
- [ ] Now open a portal on **entitled-station** and prompt **"What can you do here?"** → same capability set, and **no** plan-limit language (nothing is unentitled there, so the prompt carries no plan block).
- [ ] Read the rendered prompt for both stations if you want ground truth: log `buildSystemPrompt`'s output or inspect the request payload. On legacy-station, confirm a **`## Not Included In This Plan`** section naming both packs; confirm **no** `## Entity Management Notes` and **no** `### Charting` section.

---

## §8 — Downgrade / upgrade round-trip

- [ ] **Downgrade is non-destructive:** with legacy-station on `standard`, `db:studio` → `station_toolpacks` still holds live rows for `entity_management` and `visualize` (`deleted IS NULL`). Nothing was stripped.
- [ ] **Upgrade needs no re-attach:** `npx portalai org set-tier <orgId> pro --env local --yes` → wait ~60s or restart the API → open a **new** portal on legacy-station and prompt **"Create an entity called scrabble_scores…"**. It now works, with **no** edit to the station.
- [ ] The same station's chips (§4) are no longer dimmed, `/toolpacks` badges are gone, and the pickers offer everything.
- [ ] **All-unentitled station still builds a session:** create a station whose **only** pack is `entity_management` while on `pro`, then flip to `standard`. Open a portal on it: the session **opens** (it does not error) and the agent has only the system tools (`current_time`, `station_context`). Prompt "what can you do here?" → it claims no pack capabilities and names the plan limit.
- [ ] Flip back: `npx portalai org set-tier <orgId> standard --env local --yes`.

---

## §9 — Structural guarantees (developer-facing, one-time)

These are the "can never regress" claims. Verify once; they need no running app.

- [ ] **Re-tiering needs no prompt edit.** Temporarily add `"visualize"` to `standard.builtinToolpacks` in `packages/core/src/registries/tier-catalog.ts`, run `npx portalops tier apply --env local --yes`, restart the API, and re-run the charting prompt from §7 → the agent now offers charting. **Revert the catalog edit** (`git checkout packages/core/src/registries/tier-catalog.ts`) and re-apply.
- [ ] **A new pack fails the build until it's declared.** Add a throwaway slug (e.g. `"scratch_pack"`) to `BuiltinToolpackSlugSchema` in `packages/core/src/registries/builtin-toolpacks.ts` and run `npm run type-check` → it **fails** on `PACK_PROMPT_SECTIONS` missing the entry. Revert.
- [ ] **The iff-effective guard is real.** In `apps/api/src/prompts/system.prompt.ts`, move one pack's `capability` phrase into the unconditional intro text (i.e. hardcode it) and run `cd apps/api && npm run test:unit -- src/__tests__/prompts` → the guard case for that slug **fails**. Revert.

---

## §10 — Help documentation

- [ ] `/help` → Glossary → **Plan Entitlement** exists, explains inactive-vs-removed, and cross-links Tool Pack / Station / Portal.
- [ ] `/help` → FAQ → *"Why is a tool pack on my station greyed out, and why won't the assistant use it?"* exists and its answer matches what you actually observed in §2–§4 and §7 (inactive not deleted, no re-attach after upgrade, assistant names the plan).
- [ ] The Help search finds both by typing `plan`.

---

## Sign-off

- [ ] §1 — fail-open: a blocked `usage()` disables nothing.
- [ ] §2 — both pickers: unentitled built-ins visible, unselectable, reasoned; attached ones stay removable.
- [ ] §3 — `/toolpacks`: built-in rows badged; modal states the limit and offers the upgrade.
- [ ] §4 — all four chip surfaces render an attached unentitled pack as inert.
- [ ] §5 — `?tab=billing` opens the billing tab; copy is identical for owner and non-owner.
- [ ] §6 — POST/PATCH 403 on newly-added only; rename-only and re-send succeed; nothing persisted on denial; documented in Swagger.
- [ ] §7 — the agent names the plan limit, never claims charting/stats it lacks, and reports the split via `station_context`.
- [ ] §8 — downgrade keeps rows, upgrade needs no re-attach, all-unentitled station still opens a session.
- [ ] §9 — re-tier changes claims with no prompt edit; new slug fails type-check; guard test bites.
- [ ] §10 — glossary + FAQ match shipped behavior.

- [ ] **Also confirm:** `visualize`'s placement in the shipped catalog. It's absent from both `standard` and `plus` (only `pro`/`enterprise` carry it). Discovery deferred this to the walk: if that's *not* the intended product split, file a separate ticket to re-tier it — this branch deliberately does not change catalog contents.

- [ ] _______________ (date + name) — walked against my own running stack; ready to merge.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which checkbox>
**Expected:** <what this doc says should happen>
**Got:** <screenshot / agent transcript / curl output / db row>
**Repro:** <prompt or curl + tier + which station fixture>
**Identifiers:** org id · station id · tier slug · portal id
```
