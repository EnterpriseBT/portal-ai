# Platform help as a tool pack — Discovery

**Issue:** [EnterpriseBT/portal-ai#1050](https://github.com/EnterpriseBT/portal-ai/issues/1050)

**Why this exists.** `platform_help` is a system tool. It is attached to every portal session alongside `current_time` and `station_context`, so its definition and the prompt's `## Help` section ride along in every data or access session, even ones that will never ask a product question. #1050 makes help something a station opts into: a built-in `help` pack that every tier includes, free, and never shown as an upsell.

The diagnostics `platform_help` computes today must not be lost. It explains why a station returns nothing: no packs, nothing attached, nothing the caller can read, no records yet, or packs the plan excludes. That context moves to `station_context`, which stays always available. `station_context` also learns what the agent can't say today: the organization's name, its plan, and the stations the caller can read. #1044's open question resolves to "the Help station attaches the help pack". This ticket separates *answering product questions* from *knowing where you are*.

## The current shape

### System tools and pack tools

| Piece | Location | Today |
|---|---|---|
| System tool capabilities | `packages/core/src/registries/tool-capabilities.ts:30-75` | `current_time`, `station_context` and `platform_help` (:60-74), all `alwaysAvailable`, `free`. The comment at :56-59 records why help *isn't* a pack: tier allowlists. |
| Always-available pin | `packages/core/src/__tests__/registries/tool-capabilities.test.ts:38-45`, :72, :195-235 | exactly those three |
| Session build | `apps/api/src/services/tools.service.ts:508-549` (packs → `TierService.resolveTier` → `splitBuiltinPacks().effective`), :598-617 (system tools, unconditional), :622+ (`if (enabledPacks.has(…))` blocks) | `BUILTIN_TOOL_NAMES` already lists `platform_help` (:224) |
| Cost gate | `apps/api/src/services/cost-gate.service.ts:147` | `costHint === "free"` → admitted with no charge, before any rate check, for system and pack tools alike |
| System-tool guards | `apps/api/src/__tests__/services/tools.service.test.ts:1787-1795`, :1840, :677-698, :2137, :2152-2182 | a pack-less station builds exactly the three system tools |

### The pack registry

`packages/core/src/registries/builtin-toolpacks.ts`:
- **Shape:** the slug enum is at :33-44, the pack shape at :91-97, the registry at :2267-2280.
- **Template:** `WEB_SEARCH_PACK` (:850-872) is the single-tool template.
- **Capabilities:** they're attached from a matrix (:1869+), and `attachCapabilities` (:2246) throws if one is missing.

Guards:
- `builtin-toolpacks.test.ts:31` expects "exactly ten packs", and :36-51 pins the slugs.
- `builtin-toolpack-schema-parity.test.ts` checks each mirror against its Zod schema.

These maps are typed `Record<BuiltinToolpackSlug, …>`, so the new slug won't compile until each gets an entry:
- `PACK_USES_STATION_DATA` (`station-data-packs.ts:17`);
- `PACK_ELSEWHERE` and `PACK_PROMPT_SECTIONS` (`system.prompt.ts:243`, :258);
- the web's `ICONS_BY_SLUG` (`apps/web/src/utils/tool-pack-icons.util.ts:41-52`), which isn't a typed record but falls back to a generic icon.

### Tiers and entitlement (the main risk)

- **Catalog:** `tier-catalog.ts` lists standard's (:131-137) and plus's (:167-176) packs explicitly. Pro and enterprise spread `BuiltinToolpackSlugSchema.options` (:207, :236).
- **Runtime reads the DB, not the catalog:**
  - `TierService.resolveTier` (`tier.service.ts:60-61`, :75-104) copies the `tiers.builtin_toolpacks` jsonb (`tiers.table.ts:57`).
  - `EntitlementService.splitByPolicy` (`entitlement.service.ts:108-132`) and `readStationPacks` (:207-260, `otherPlanPacks` :230) derive `effective`, `unentitled` and "packs elsewhere" from that row.
- **Custom tiers freeze their pack list:**
  - `portalops tier apply` (`packages/devops-cli/src/commands/tier.ts:140-200`) converges catalog slugs only.
  - `tier create` (`buildTierCreateValues`, :398-432) copies the slug list as it stood at create time.
  - `tier update` (:435-452) can't change packs.
  - **So `demo` and every per-client tier would treat a new `help` slug as unentitled.** That's the "Not included in your plan" upsell the ticket forbids.
- **Surfaces that show "not included":**
  - the prompt's `## Not Included In This Plan` (`system.prompt.ts:1195-1250`);
  - web `useBuiltinEntitlements` (`use-builtin-entitlements.util.ts:42-64`), `UNENTITLED_PACK_REASON` (`tool-packs.util.ts:176`);
  - the write guard (`station.router.ts:972`).
- **No schema change:** `station_toolpacks.builtin_slug` is free text (`station-toolpacks.table.ts:26-37`), so no schema change is needed for the slug.

### `platform_help` and `station_context`

- **`platform-help.tool.ts`:**
  - situations (:63-69): `no_packs | attachments_missing | attachments_inaccessible | no_records | unentitled_packs | default`;
  - `gatherFindings` (:128-211): pack split, `loadStation`, one bounded `countByConnectorEntityIds`, and `StationAttachmentService.countsForCaller`; fail-soft (:195-210);
  - `matchSituation` (:214-232): first match wins;
  - prose (:284-319), and `composeAnswer` (:321-350), which adds FAQ/glossary entries and Help links.
- **`station-context.tool.ts`:**
  - `include` (:39-56): `entities | connectorInstances | entityGroups | capabilities | columnDefinitions | toolPacks`;
  - output (:59-146): a `station` header (id, name, timezone) is always present;
  - it reads the org row but only for timezone (:199-202). No org name, no plan, no station list, no diagnostics.
- **Readable stations:** `StationQueryService.listForCaller` (`station-query.service.ts:48`) applies the visibility predicate.

### Prompt and web

- **`## Help`** is unconditional in the base `lines` (`system.prompt.ts:896-901`).
- **Pack sections** come from `effectiveSections()` (:763-769) via `PACK_PROMPT_SECTIONS`, and the #284 guard (`system.prompt.test.ts:1555-1585`) holds "a pack's markers appear iff the pack is effective".
- **Station Scope's** "packs elsewhere" list (:1331-1346) prints `PACK_ELSEWHERE[slug]` for `otherPlanPacks`.
- **Pins to change:** `system.prompt.test.ts:1854-1890` ("renders ## Help even when no toolpacks are enabled"), plus the Station Scope pins (:863-1060).
- **Web pickers:** `EditStationDialog.component.tsx:48-73` and `CreateStationDialog.component.tsx:250-330` show name and icon only. Descriptions appear only in `ToolpackMetadataModal.component.tsx:75` (Toolpacks page).

## The design space

### Decision 1 — Making `help` entitled on every tier, including custom DB tiers

**A. Data:** a migration appends `help` to every `tiers.builtin_toolpacks` row, and `tier create` keeps copying the slug list. Every future always-free pack needs another backfill. A tier created by a CLI built before the slug existed (or edited by hand) drifts again.

**B. Code:** a core constant `ALWAYS_ENTITLED_PACKS = ["help"]`, and `TierService.resolveTier` unions it into `builtinToolpacks` on read. Every consumer then sees it: the split, "packs elsewhere", the web entitlements and the write guard. The catalog also lists it, so `tier apply` and the guard stay honest.

**C. Both.**

| | A (backfill) | B (union on read) | C |
|---|---|---|---|
| Custom/unmanaged tiers covered | once, at migration time | always | always |
| New always-free packs later | another backfill each | add to the constant | both |
| Single source | no (rows + catalog) | yes | no |
| Stored row reflects reality | yes | no (row may lack it) | yes |

**Lean: B.** It's one rule held in one place, it can't drift, and it covers tiers nobody manages. The catalog still lists `help` in every tier, as the ticket asks, and a guard test fails a tier that omits it, so `tier apply`'s view and the runtime agree for catalog tiers.

### Decision 2 — Where the diagnostics live once `platform_help` is optional

**A.** A `status` block that `station_context` **always** returns, not gated behind `include`. It carries the situation and its facts (packs effective, attachment gaps, caller-inaccessible counts, records present, plan-excluded packs). It's computed by a shared `StationDiagnosticsService` moved out of `platform-help.tool.ts`.

**B.** Compute the findings at session build and print them as static prompt lines.

**C.** A + a one-line Station Scope instruction: "when a query comes back empty or a capability is missing, read `station_context`'s status before answering".

| | A | B | C |
|---|---|---|---|
| Cost per session | only when called | one bounded count on **every** session start | only when called |
| Fresh mid-session (e.g. after an import) | yes | stale | yes |
| Agent knows to look | needs prompting | always in view | yes |

**Lean: C.** It's fresh and costs nothing until asked. The shared service keeps one implementation: `platform_help` calls it too, for its situation prose, so help and context never disagree.

### Decision 3 — Organization and station metadata in `station_context`

**A.** An always-present `organization` header (`name`, `plan: { slug, displayName }`), plus a new `include: "stations"` returning the caller's readable stations (`id`, `name`, `description`, `packs`). It's capped at 25 (by name), with `totalCount`.

**B.** Everything always-on.

**C.** A separate system tool, `organization_context`.

**Lean: A.** The header is two cheap fields the agent needs constantly. The station list scales with the org, so it's opt-in and capped, and the existing `include` pattern carries it. A third system tool would undo the point of trimming every session's tool list.

### Decision 4 — How `## Help` becomes conditional

Move `## Help` into `PACK_PROMPT_SECTIONS.help` with markers `## Help` and `platform_help`. The #284 guard then *proves* it appears iff the pack is effective, and Station Scope lists it via `PACK_ELSEWHERE.help` ("answers questions about how Portals works, with links into Help"). **Lean: this, with no alternative worth weighing.** It's exactly the pack-section mechanism, and the "renders ## Help even when no toolpacks are enabled" pin inverts.

## Tradeoff comparison

| | D1 union on read | D2 status + prompt line | D3 org header + `stations` include | D4 pack prompt section |
|---|---|---|---|---|
| New pattern | `ALWAYS_ENTITLED_PACKS` (small) | shared diagnostics service | no | no |
| Contract change | tier resolution | `station_context` output | `station_context` output | prompt |
| Spread to spec | yes | yes | yes | yes |

## Recommendation

1. **The pack.** Add a built-in `help` pack (name "Help") holding `platform_help`, with its mirror `{ question?: string }`, `costHint: free`, and `PACK_USES_STATION_DATA.help = false`.
   - `platform_help` leaves `SYSTEM_TOOL_CAPABILITIES`. `tools.service.ts` builds it only when `enabledPacks.has("help")`.
   - Guards change from "three system tools" to two, and from ten packs to eleven.
2. **Entitlement.** Add `ALWAYS_ENTITLED_PACKS = ["help"]` to core.
   - `TierService.resolveTier` unions it into `builtinToolpacks`.
   - `tier-catalog.ts` lists `help` in every tier, and a guard fails a catalog tier without it.
3. **`StationDiagnosticsService`.** Move `gatherFindings`/`matchSituation` into a new `StationDiagnosticsService`, used by both `platform_help` and `station_context`.
4. **`station_context` output.** It always returns:
   - `organization: { name, plan: { slug, displayName } }`;
   - `status: { situation, packsEffective, attachments: { missing, inaccessible }, hasRecords, planExcludedPacks }`.

   It also gains `include: "stations"` (readable stations, cap 25, `totalCount`).
5. **Prompt.** `## Help` moves to `PACK_PROMPT_SECTIONS.help`, and `PACK_ELSEWHERE.help` names the pack. Station Scope gains one line pointing at `station_context`'s `status` when results are empty, and tells the agent to name a readable station (from `include: "stations"`) when it suggests opening one.
6. **Web.** Add `ICONS_BY_SLUG.help` (a help icon). The pickers list Help like any pack, and its description shows on the Toolpacks page.
7. **No migration attaches the pack.** Existing stations are untouched, and #1044 attaches it to the Help station. Amend #1044.
8. **Docs.** Update:
   - `CLAUDE.md` (the system tools list in the doc inventory, the cost-control note);
   - the FAQ "What are tool packs?" and the glossary "Tool Pack";
   - stale comments (`registries/index.ts:16`, `station-data-packs.ts:11,43`, `station-attachments.util.ts:4`, `station-context.tool.ts:23`).

## Open questions

1. **Does the station picker need to show the Help pack's description?** Today it shows names and icons only, for every pack. **Lean: no picker change.** The description shows on the Toolpacks page like every other pack. A picker that described one pack only would be inconsistent; describing all of them is a separate UI ticket.
2. **What does the demo station get?** `DemoSeedService.seedToolpacks` enables every `BUILTIN_TOOLPACKS` slug, so a new demo's Demo station gains Help automatically. **Lean: accept that.** A demo is where product questions get asked, and it needs no #1035 change.
3. **Should `platform_help`'s situation prose stay in the help tool** when `station_context` already reports the same facts? **Lean: yes, via the shared service.** Help turns facts into guidance with Help links; context reports facts. One source, two renderings.
4. **e2e fixture:** `--all-toolpacks` gives fixture stations Help after `e2e:seed`. **Lean: accept it**, and note it in `packages/e2e/README.md`.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A. The change is read-path and session-build only, with no new writes.
- **Accuracy & auditability:** N/A. Help is free by design, so there's no charge to record.
- **Failure modes:** diagnostics stay **fail-soft**, as today. An unreadable count yields `status.situation: "unknown"` rather than failing `station_context`, which every session depends on. Entitlement fails *open* for `help` only, which is safe: it's free and grants no data access.
- **Scale & unbounded growth:**
  - `include: "stations"` is capped at 25 with `totalCount`, and the diagnostics count is the existing bounded query.
  - Removing `platform_help` from data sessions *shrinks* every session's tool list.
- **Multi-tenancy:** readable stations go through `StationQueryService.listForCaller` (the visibility predicate), so a member never learns another member's private station. The org header is the caller's own org.
- **Contract stability:** `ALWAYS_ENTITLED_PACKS` is the seam for any future free-everywhere pack. `station_context` grows by additive fields.
- **Data lifecycle:** N/A. Nothing is stored.

## What this doesn't decide

- **Retrieval quality, troubleshooting content and the rendered help block** are #1049's.
- **Making `current_time` / `station_context` attachable** was decided against at filing.
- **Showing pack descriptions in the station pickers** (open question 1) is UI polish for all packs, not this ticket.
- **Backfilling `help` into stored tier rows** (Decision 1 option A) isn't needed under B. Revisit only if something reads `tiers.builtin_toolpacks` without going through `TierService`.

## Next step

`docs/PLATFORM_HELP_PACK.spec.md` pins:
- the pack entry and mirror;
- `ALWAYS_ENTITLED_PACKS` and its `resolveTier` union;
- `StationDiagnosticsService`'s signature and `station_context`'s new `organization` / `status` / `stations` output;
- the prompt sections.

`docs/PLATFORM_HELP_PACK.plan.md` slices it roughly as:
1. core registry, entitlement constant and guards;
2. the diagnostics service extraction (behaviour-preserving);
3. `station_context` growth;
4. session build and prompt;
5. web icon and docs.
