# Built-in toolpack entitlement surfacing — Plan

**TDD-sequenced implementation of #214's missing built-in axis: the entitlement read + core option-disabling, the five display surfaces, the `403` station-write guard over newly-added slugs, the configured→effective split in the agent's context, and the declared per-pack prompt surface that makes "the agent claims only what it has" structural.**

Spec: `docs/BUILTIN_TOOLPACK_ENTITLEMENT_SURFACING.spec.md`. Discovery: `docs/BUILTIN_TOOLPACK_ENTITLEMENT_SURFACING.discovery.md`. Issue: #284. Builds on **shipped #214** (`TierPolicy.entitlements`, `ToolService.buildAnalyticsTools`'s filter, the custom-axis badge) and **#172** (`TierService.resolveTier`, `GET /api/organization/usage`) — all on `main`.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/builtin-toolpack-entitlement-surfacing`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"). No migration, no seed.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/web    && npm run test:unit
cd apps/api    && npm run test:unit
cd apps/api    && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — leaf logic before wiring, and the entitlement *source* before every consumer:

- **Slice 1** — the primitives every surface reads: the pure predicate, the hook, the core option-disable, the `?tab=billing` contract, `UpgradeLink`. Nothing user-visible changes yet.
- **Slice 2** — the five display surfaces consume slice 1. This is the ticket's visible deliverable and closes the "four surfaces each had a chance to say so" complaint.
- **Slice 3** — server enforcement. `EntitlementService` lands here because slices 4–5 need it; the `403` closes the write path that creates the inconsistent state.
- **Slice 4** — the agent's *context* stops lying: configured→effective split in `buildStationContext`, `effectiveToolPacks`/`unentitledToolPacks` on `StationContext`, the `toolPacks` section on `station_context`. Consumes slice 3's service. The three currently-gated prompt sections become truthful by rename alone.
- **Slice 5** — the agent's *claims* become structurally honest: `PACK_PROMPT_SECTIONS`, assembled cross-cutting prose, the plan-limit block, the iff-effective guard. Depends on slice 4's field names. Carries doc-sync.

**Slices 1–2 (web/core) and slice 3 (api) are independent of each other** — 3 could land first if the server hole is the priority. 4 depends on 3; 5 depends on 4.

---

## Slice 1 — Entitlement primitives + core option-disabling

The values and widgets every later surface reads. No display surface consumes them yet, so nothing user-visible changes.

**Files**

- Edit: `packages/core/src/ui/searchable-select/types.ts` — `SelectOption.disabledReason?: string`.
- Edit: `packages/core/src/ui/searchable-select/MultiSearchableSelect.tsx` — `getOptionDisabled` + reason line + `aria-disabled` in the existing `renderOption`.
- Edit: `apps/web/src/utils/tool-packs.util.ts` — `ALL_BUILTIN_SLUGS`, `isBuiltinPackEntitled`, `unentitledBuiltins`, the four copy constants.
- New: `apps/web/src/utils/use-builtin-entitlements.util.ts` — `useBuiltinEntitlements()`.
- New: `apps/web/src/components/UpgradeLink.component.tsx` — pure UI, TanStack `Link` + `UPGRADE_CTA_LABEL`.
- Edit: `apps/web/src/utils/routes.util.ts` — `SettingsTab`, `SETTINGS_TAB_INDEX`, `settingsTabIndexFromSearch`.
- Edit: `apps/web/src/routes/settings.tsx` — `validateSearch` declaring `tab?: SettingsTab`.
- Edit: `apps/web/src/views/Settings.view.tsx` — seed `useTabs(settingsTabIndexFromSearch(window.location.search))`.
- New: `apps/web/src/__tests__/useBuiltinEntitlements.test.tsx`.
- Edit tests: `packages/core/src/__tests__/ui/MultiSearchableSelect.test.tsx`, `apps/web/src/__tests__/ToolPackUtil.test.ts`, `apps/web/src/__tests__/SettingsView.test.tsx`.

**Steps**

1. **Core tests (spec §core cases 1–4).** A `disabled: true` option renders `aria-disabled` and does not select on click; `disabledReason` renders under the label and is absent when enabled; an already-selected value whose option is now disabled still renders as a tag **and is deletable**; enabled options behave as shipped. Run; fail.
2. **Implement** `disabledReason` on the type + `getOptionDisabled={(o) => o.disabled === true}` and the reason line in `renderOption`. `renderTags` untouched. Green.
3. **Web tests (spec §web cases 1–5, 6–8).** `isBuiltinPackEntitled`: entitled → true, unentitled → false, `org:<uuid>` → true, unknown string → true; `unentitledBuiltins` preserves input order. Hook: resolved query → the tier's set; no data → `ALL_BUILTIN_SLUGS` + `isLoading: true`; query error → `ALL_BUILTIN_SLUGS`. Run; fail.
4. **Implement** the predicate + constants + hook. The hook reads `sdk.organizations.usage()` and falls back permissively (Q1 — fail open). Green.
5. **Tab-deep-link tests (spec §web cases 22–24, +1 not in the spec's enumeration).** `?tab=billing` mounts tab index 2; no param → 0; unknown value → 0. Plus one case for `UpgradeLink`: renders `UPGRADE_CTA_LABEL` and targets `/settings` with `search.tab === "billing"`. Run; fail.
6. **Implement** `SettingsTab`/`SETTINGS_TAB_INDEX`/`settingsTabIndexFromSearch`, the route's `validateSearch`, the `useTabs` seed, and `UpgradeLink`. Green.
7. Lint + type-check across all three packages.

**Done when:** 16 cases pass; `MultiSearchableSelect` honors `SelectOption.disabled` for every existing consumer; `/settings?tab=billing` opens Subscription & Billing; no station/toolpack surface has changed appearance.

**Risk:** `validateSearch` on `/settings` is the app's first, and coexists with the shipped `?billing=success|cancelled` reader that strips its param via `history.replaceState` outside the router. Slice 1's `SettingsView.test.tsx` billing cases are the canary — they must stay green. Also confirm `routeTree.gen.ts` regenerates cleanly and is **never hand-formatted** (`CLAUDE.md` → Formatting enforcement).

---

## Slice 2 — The five display surfaces

Every place a built-in pack is offered or shown now tells the truth. This is the user-visible deliverable.

**Files**

- Edit: `apps/web/src/components/CreateStationDialog.component.tsx` — `entitledBuiltinSlugs?: ReadonlySet<string>`, `getOptionDisabled`, a `renderOption` with the reason.
- Edit: `apps/web/src/components/EditStationDialog.component.tsx` — same prop; `BUILTIN_TOOL_PACK_OPTIONS` becomes a `useMemo` marking unentitled entries `disabled` + `disabledReason`.
- Edit: `apps/web/src/components/ToolPackChip.component.tsx` — `entitled?: boolean` (default `true`) → muted/dashed + tooltip + `aria-label` + `data-entitled="false"`.
- Edit: `apps/web/src/components/ToolPackChipWithMetadata.component.tsx` — `entitled` on both prop types, forwarded to chip **and** modal; container reads the hook.
- Edit: `apps/web/src/components/ToolpackMetadataModal.component.tsx` — `entitled?: boolean` → `<Alert severity="info">` + `UpgradeLink` above the description.
- Edit: `apps/web/src/views/Toolpacks.view.tsx` — `ToolpackRow.slug`, `entitledBuiltinSlugs` prop, the badge condition, `entitled` into the modal; `UNENTITLED_PACK_BADGE` replaces the inline literal at `:152`.
- Edit: `apps/web/src/components/StationList.component.tsx`, `DefaultStationCard.component.tsx` — UI prop + `Connected` container supplies it.
- Edit: `apps/web/src/views/StationDetail.view.tsx`, `Portal.view.tsx` — `entitled={isEntitled(pack)}` per chip.
- Edit stories: `ToolPackChip.stories.tsx`, `ToolpackMetadataModal.stories.tsx` — unentitled variants.
- Edit tests: `CreateStationDialog.test.tsx`, `EditStationDialog.test.tsx`, `ToolPackChip.test.tsx`, `ToolPackChipWithMetadataUI.test.tsx`, `ToolpackMetadataModal.test.tsx`, `Toolpacks.view.test.tsx`, `StationList.test.tsx`, `DefaultStationCard.test.tsx`.

**Steps**

1. **Picker tests (spec §web cases 9–14).** Create + Edit: an unentitled option renders `UNENTITLED_PACK_REASON` and is not selectable; entitled options select normally; (Edit) an already-attached unentitled slug stays in `value` and is removable. Run; fail.
2. **Implement** both pickers against slice 1's predicate + `SelectOption.disabled`. Green.
3. **Chip + modal tests (spec §web cases 15–21).** Default renders exactly as today; `entitled={false}` sets `data-entitled="false"`, the tooltip copy, and an `aria-label` naming the limit; label text unchanged; `ToolPackChipWithMetadataUI` forwards to both children; the modal shows the alert + upgrade link only when unentitled. Run; fail.
4. **Implement** the chip variant, the forwarding, and the modal alert. Green.
5. **List/badge tests (spec §web cases 22–24 for `/toolpacks`, plus the two chip-surface cases).** An unentitled built-in row is badged, an entitled one is not, the #214 custom-axis badge still behaves; the modal for an unentitled row receives `entitled={false}`; `StationListUI`/`DefaultStationCardUI` render an inert chip from the prop. Run; fail.
6. **Implement** `ToolpackRow.slug` + the badge condition + the four chip-surface wirings (containers pass the set; pure UI stays context-agnostic per the Component File Policy). Green.
7. Add the unentitled Storybook variants. Lint + type-check.

**Done when:** 18 cases pass; on a `standard`-tier org every offered/attached unentitled built-in is visibly inert with a reason and an upgrade path; entitled packs are pixel-unchanged.

**Risk:** `Toolpacks.view`'s `DataTable` rows are cast (`pagedRows as unknown as Record<string, unknown>[]`), so a missing `slug` on `ToolpackRow` fails at runtime, not compile time — case "unentitled built-in row is badged" is the guard. Chip default-`true` is what keeps the existing chip tests green; if any go red, the default regressed.

---

## Slice 3 — Server enforcement

`EntitlementService` (one definition of "effective") + the `403` on both station write paths. Closes the path that creates the inconsistent state.

**Files**

- New: `apps/api/src/services/entitlement.service.ts` — `splitBuiltinPacks`, `customPacksEntitled`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `STATION_TOOLPACK_NOT_ENTITLED` in the Toolpacks block.
- Edit: `apps/api/src/routes/station.router.ts` — `denyUnentitledBuiltins` helper; POST guard over all `builtinSlugs`; PATCH guard over the `findByStationId` diff; `403` in both `@openapi` blocks.
- Edit: `apps/api/src/services/tools.service.ts` — `:429-449` delegates to `EntitlementService`; behavior unchanged.
- New: `apps/api/src/__tests__/services/entitlement.service.test.ts`.
- Edit tests: `packages/core/src/__tests__/registries/tier-catalog.test.ts`, `apps/api/src/__tests__/services/tools.service.test.ts`, `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`.

**Steps**

1. **Catalog invariant (spec §core case 5).** Every `TIER_CATALOG` entry's `builtinToolpacks` contains `data_query`, so POST's implicit default can never trip its own guard. Run; fail or pass — if it already passes, keep it as the pin (it protects a future edit, and the comment must say so).
2. **Service tests (spec §api-unit cases 1–5).** `splitBuiltinPacks` splits configured into effective/unentitled preserving order; an allowlist slug unknown to the registry is ignored with a `warn`; a missing org row falls back to the default tier; empty configured input → both empty, no throw; `customPacksEntitled` reflects the tier. Run; fail.
3. **Implement `EntitlementService`** by lifting `tools.service.ts:429-449` verbatim (same `resolveTier(org ?? { tier: "" })` fallback, same unknown-slug warn). Green.
4. **Delegate `tools.service`** to it (spec §api-unit case 11) and re-run the shipped entitlement guard tests (`tools.service.test.ts:1231-1420`, including "every configured pack unentitled ⇒ system tools only — no throw" at `:1343`) **unchanged**. Green.
5. **Integration tests (spec §integration cases 1–6).** POST with an unentitled built-in → `403 STATION_TOOLPACK_NOT_ENTITLED` and **no station row and no toolpack rows**; POST with no `toolPacks` (the `["data_query"]` default) → 201 on `standard`; PATCH adding an unentitled built-in → 403, rows unchanged; rename-only PATCH on an already-unentitled station → 200; PATCH re-sending an already-persisted unentitled slug → 200; PATCH removing then re-adding it → 200 then 403. Run; fail.
6. **Implement** the `ApiCode`, `denyUnentitledBuiltins` (empty input short-circuits with no tier resolve), the POST guard **before** `stations.create`, and the PATCH diff guard **before** `stations.update`. Add the `warn` log with org id, tier slug, denied slugs. Green.
7. Add the `403` `@openapi` responses to both blocks (modeled on `toolpacks.router.ts:289`). Lint + type-check.

**Done when:** 13 cases pass; an unentitled built-in cannot be newly attached by either route; every already-attached unentitled slug still round-trips through PATCH; `buildAnalyticsTools` behavior is byte-identical to `main`.

**Risk:** POST ordering — the guard must run before `stations.create`, or a denied request leaves an orphan station row. Integration case 1 asserts on both tables. The check-then-act race (downgrade mid-PATCH) is accepted per discovery: the raced outcome is an inert slug, the tolerated downgrade state.

---

## Slice 4 — The agent's context stops lying

`configured` vs `effective` becomes a name, not a comment. The three already-gated prompt sections become truthful by the rename alone; `station_context` gains the field the agent can read.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — `StationContext.toolPacks` → `effectiveToolPacks` + `unentitledToolPacks`; the 6 read sites (`:144`, `:221-222`, `:322`, `:393`, `:440`).
- Edit: `apps/api/src/services/portal.service.ts` — `buildStationContext` splits its `toolPacks` (configured) argument via `EntitlementService`; the two `entity_management` gates at `:1026`/`:1031` key off `effective`.
- Edit: `apps/api/src/tools/station-context.tool.ts` — `StationContextResponse.toolPacks?: { effective, unentitled }`, `"toolPacks"` in the `include` enum + default set, one clause in the tool `description`.
- Edit tests: `apps/api/src/__tests__/services/portal.service.test.ts`, `apps/api/src/__tests__/tools/station-context.tool.test.ts`, `apps/api/src/__tests__/prompts/system.prompt.test.ts` (rename only).

**Steps**

1. **Rename first, mechanically.** Remove `toolPacks` from `StationContext` and add `effectiveToolPacks` + `unentitledToolPacks`; `npm run type-check` enumerates every read site (the field is removed, not aliased — no compat shim per `feedback_no_compat_aliases`). Update the 6 sites and the existing prompt-test `makeContext` helper. Green with **no assertion changes**.
2. **Context tests (spec §api-unit cases 6–8).** `buildStationContext` returns effective/unentitled from a configured input; an unentitled `entity_management` loads **neither** `entityCapabilities` nor `connectorInstances`; an entitled one still loads both. Run; fail.
3. **Implement** the split inside `buildStationContext` via `EntitlementService.splitBuiltinPacks`. Callers (`portal.service.ts:328`, `portal-events.router.ts:100`) keep passing configured packs — unchanged. Green.
4. **Tool tests (spec §api-unit cases 9–11).** The `toolPacks` section is present by default with both lists; excluded when `include` omits it; a configured-but-unentitled pack appears in `unentitled`, not `effective`. Run; fail.
5. **Implement** the response field, the `include` member, and the description clause; the tool resolves its own split from `stationToolpacks.findByStationId` + `EntitlementService`. Green.
6. Lint + type-check.

**Done when:** 6 new cases pass, every pre-existing prompt pin passes unchanged, and the prompt's three gated sections (Entity Management, SQL Guidance, Charting) are keyed off packs whose tools actually exist. The agent can read the split from a field.

**Risk:** the rename is broad but compile-enforced; the real risk is a *test* helper that constructs `StationContext` with an object literal and silently keeps `toolPacks` as an excess property — `type-check` catches excess properties on literals, so this is covered, but re-run the full api unit suite, not just the prompt file.

---

## Slice 5 — Declared capability surface + doc-sync

The agent can no longer claim a capability it doesn't have — enforced by an exhaustive `Record` (compile time) and an iff-effective guard (test time), not by prose.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — `PackPromptSection` + `PACK_PROMPT_SECTIONS: Record<BuiltinToolpackSlug, PackPromptSection>`; existing gated blocks moved under their owning slug; the role intro (`:62-92`), Response Style (`:458-462`) and interpretive-tools sentence (`:487-492`) assembled from effective packs; the `## Not Included In This Plan` block; the three-way "no tool fits" branch.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — the guard + 8 further cases.
- Edit: `apps/web/src/utils/glossary.util.ts`, `apps/web/src/utils/faq.util.ts` — the "inactive on your plan" concept.
- Edit tests: `apps/web/src/__tests__/faq.util.test.ts` (the `toHaveLength(21)` pin at `:78` and its category comment), `glossary.util.test.ts` if its filter counts move.

**Steps**

1. **Guard test first (spec §api-unit case 12).** `it.each(BuiltinToolpackSlugSchema.options)`: with only that slug effective, every string in its `markers` appears; with every *other* slug effective, none of them appear. Write it against the map you are about to declare; it fails to compile until `PACK_PROMPT_SECTIONS` exists, then fails red on the ungated prose.
2. **Remaining prompt tests (spec §api-unit cases 13–20).** `capability` phrases pairwise distinct and non-substring; a configured-but-unentitled pack contributes no markers (**the reported bug, as a test**); `## Not Included In This Plan` renders with pack names + the billing path when `unentitledToolPacks` is non-empty and is absent when empty; zero effective packs → no capability enumeration but role/prohibitions/"no tool fits" still render; the "no tool fits" guidance carries all three branches; Response Style's block list and interpretive-tools sentence name only effective packs' entries. Run; fail.
3. **Declare `PACK_PROMPT_SECTIONS`** — one entry per slug, `render: () => []` for the four packs that carry no guidance today (`statistics`, `regression`, `financial`, `web_search`), each still declaring its `capability` / `blocks` / `interpretiveTools` / `markers`. Move the existing blocks verbatim under their owners: Entity Management Notes + "Creating a new entity" → `entity_management`; SQL Guidance + Schema Introspection → shared by `data_query`/`visualize` exactly as `:220-222` does today; Charting → `visualize`.
4. **Assemble the cross-cutting prose** from the effective set and delete the hardcoded enumerations. Add the plan-limit block and the three-way branch. Green.
5. **Doc-sync** (same PR — stale docs are a bug here, per `CLAUDE.md` → "Keeping Documentation in Sync"): a glossary term for the configured-vs-effective split, an FAQ entry ("Why is a tool pack on my station greyed out?"), and the `faq.util.test.ts` count pin bumped 21 → 22 with its category comment updated. `builtin-toolpacks.ts` needs no mirror change (no pack description moves).
6. Lint + type-check. Full-suite run across all four commands.

**Done when:** 9 prompt cases + the doc-sync pins pass; adding a slug to `BuiltinToolpackSlugSchema` fails `type-check` until it declares a section; moving a pack between tiers in `tier-catalog.ts` changes the agent's claims with **no prompt edit**.

**Risk:** `capability` phrases must be pairwise distinct and non-substring or the guard produces false failures across packs — that invariant is itself a case (step 2), so it fails loudly rather than confusingly. Second risk: assembled prose reading worse than the hand-written sentences; the phrases are data, so rewording is a one-line change, and the smoke walk includes reading a rendered 1-pack and 5-pack prompt.

---

## Sequence summary

| Slice | What lands | Cases | Gating check |
|---|---|---|---|
| 1 | Predicate + hook + copy constants; `SelectOption.disabled` honored; `?tab=billing` + `UpgradeLink` | 16 | core + web unit; nothing user-visible changed |
| 2 | Both pickers, `/toolpacks` badge + modal, four chip surfaces | 18 | web unit; unentitled packs visibly inert with a reason |
| 3 | `EntitlementService`, `STATION_TOOLPACK_NOT_ENTITLED`, both `403`s + `@openapi`, catalog invariant | 13 | api unit + integration; `buildAnalyticsTools` unchanged |
| 4 | `effectiveToolPacks`/`unentitledToolPacks`, `buildStationContext` split, `station_context.toolPacks` | 6 | api unit; every pre-existing prompt pin green unchanged |
| 5 | `PACK_PROMPT_SECTIONS` + assembled prose + plan-limit block + iff-effective guard + doc-sync | 9 | api unit + web doc pins; full suite |

**≈ 62 cases.** (61 from the spec's enumeration + 1 `UpgradeLink` render/href case introduced in slice 1.)

## Cross-slice notes

- **`EntitlementService` is the seam.** It lands in slice 3 and is consumed by 3, 4, and 4's tool. If slices 1–2 are deferred for review, slice 3 still stands alone.
- **Types that span slices.** `SelectOption.disabledReason` (slice 1) is consumed only in slice 2; `effectiveToolPacks` (slice 4) is consumed by slice 5's assembly. Neither is a forward dependency — each is declared and tested in its own slice.
- **No test crosses a boundary.** Slice 4 renames without changing a single prompt assertion; the assertions about *what the prompt claims* all live in slice 5, where the behavior lands.
- **`routeTree.gen.ts`** regenerates when `routes/settings.tsx` gains `validateSearch` (slice 1). It is generator-owned — commit it, never hand-format it.
- **Doc-sync is slice 5, step 5**, not a follow-up: the glossary/FAQ entries and the `faq.util.test.ts:78` count pin (21 → 22) land in this PR.
- **Cache invalidation:** nothing new. No mutation is added on the web side; the entitlement read is a query, and `usage()` is already invalidated by the billing flows.
- **Copy lives in one place.** Every surface reads the constants from `tool-packs.util.ts`; the inline `"Inactive on your plan"` literal at `Toolpacks.view.tsx:152` moves into `UNENTITLED_PACK_BADGE` in slice 2 so the two axes can never drift.
- **Smoke comes after slice 5** (`/smoke 284`), and includes the `visualize`-on-`standard` confirmation that discovery Q5 deferred to the walk, plus reading a rendered prompt for a 1-pack and a 5-pack station.

## Next step

Implementation begins on this branch once discovery + spec + plan are confirmed — **slice 1 first, tests before implementation, one commit per slice.**
