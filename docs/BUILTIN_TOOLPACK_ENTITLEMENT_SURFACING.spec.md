# Built-in toolpack entitlement surfacing — Spec

**Issue:** [EnterpriseBT/portal-ai#284](https://github.com/EnterpriseBT/portal-ai/issues/284) · **Discovery:** `docs/BUILTIN_TOOLPACK_ENTITLEMENT_SURFACING.discovery.md` · **Branch:** `feat/builtin-toolpack-entitlement-surfacing` → `main`

Pins the contract for making #214's built-in entitlement axis legible: one client-side entitlement read, per-option disabling in the two station pickers, an inert chip variant across four surfaces, a badge + modal notice on `/toolpacks`, a shared `?tab=billing` upgrade target, a `403 STATION_TOOLPACK_NOT_ENTITLED` guard over *newly added* slugs on the station write paths, and — the reported bug's actual fix — an agent whose entire capability surface is derived from the **effective** (configured ∩ entitled) pack set and structurally cannot claim otherwise.

## Key decisions (flag for review)

Ratified from discovery (D1–D8, Q1–Q6):

1. **D1 — no new endpoint.** Entitlements reach the web through the shipped `GET /api/organization/usage` → `sdk.organizations.usage()` → `tier.entitlements.builtinToolpacks`. No response contract changes anywhere.
2. **D2 — pure predicate + read hook.** `tool-packs.util.ts` gets the pure predicate; a new `use-builtin-entitlements.util.ts` wraps the query. Containers call the hook; pure UI takes primitives.
3. **D3 — core honors `SelectOption.disabled`.** `MultiSearchableSelect` threads `getOptionDisabled` and renders a reason; the Create dialog's MUI `Autocomplete` uses `getOptionDisabled` directly. Filtering unentitled options out is rejected — visible-but-disabled *is* the deliverable.
4. **D4 — one chip, one variant prop.** `ToolPackChip.entitled?: boolean` (default `true`).
5. **D5 — newly-added-only server guard.** Async, after `parseToolpackRefs` (which stays sync-pure in spirit — it keeps its existing custom-id lookup and gains nothing). PATCH diffs against `stationToolpacks.findByStationId`. Already-persisted unentitled slugs are tolerated forever.
6. **D6 — the agent reads a field, not prose.** `station_context` carries the effective/unentitled split *and* the prompt's source of truth is corrected.
7. **D7 — `/settings?tab=billing`.** One shared search-param contract; `Settings.view` seeds its tab from it.
8. **D8 — the prompt's capability surface is declared and exhaustive.** `PACK_PROMPT_SECTIONS: Record<BuiltinToolpackSlug, …>` (a new slug is a compile error until declared), cross-cutting prose *assembled* from effective packs, and a guard test asserting each pack's markers appear **iff** the pack is effective. Re-tiering changes what the agent claims with no prompt edit.
9. **Q1 — the UI fails open**, the server guard fails closed. A stale side query must never forbid legitimate work; a missing policy must never permit a new attach.
10. **Q4 — copy never names the required tier**, and is identical for owners and non-owners.

Two refinements this spec makes beyond the discovery's letter (**please confirm**):

- **`StationContext.toolPacks` is renamed `effectiveToolPacks`.** Discovery kept the name and changed its meaning. The ambiguity between *configured* and *effective* is precisely what produced the bug, so the field name carries the semantics instead of a JSDoc line. Mechanical rename across `system.prompt.ts` (6 read sites), 2 callers, and the prompt tests.
- **The configured→effective split becomes `EntitlementService`**, not a router-local helper (discovery Q2). It has four consumers — the router guard, `buildStationContext`, `StationContextTool`, and `tools.service.ts`'s existing filter — so one definition of "effective" beats three. Q2's "promote it if a third write path appears" is satisfied on arrival.

## Scope

### In scope

1. Web entitlement read: pure predicate + `useBuiltinEntitlements()` hook + copy constants.
2. `packages/core` — `SelectOption.disabledReason`, `MultiSearchableSelect` per-option disabling.
3. Both station pickers render unentitled built-ins visible, unselectable, reasoned.
4. `ToolPackChip.entitled` + forwarding through `ToolPackChipWithMetadata` and `ToolpackMetadataModal`, wired at all four chip surfaces.
5. `/toolpacks` badge extension to built-in rows + the modal notice.
6. `?tab=billing` search contract, `Settings.view` seeding, one shared upgrade link.
7. `EntitlementService` + `403 STATION_TOOLPACK_NOT_ENTITLED` on `POST /api/stations` and `PATCH /api/stations/:id`, newly-added slugs only.
8. `effectiveToolPacks` + `unentitledToolPacks` on `StationContext`; `toolPacks` section on `station_context`.
9. `PACK_PROMPT_SECTIONS` + assembled cross-cutting prose + the three-way "no tool fits" branch + the iff-effective guard test.
10. `tier-catalog.test.ts` invariant: every tier entitles `data_query`.
11. Doc-sync: `glossary.util.ts`, `faq.util.ts`.

### Out of scope

- Changing which packs a tier entitles (product data in `tier-catalog.ts`); `visualize`'s placement is confirmed at smoke, not changed.
- Retroactively stripping unentitled packs from existing stations; any `station_toolpacks` migration.
- The custom-toolpack axis (#214) beyond extending its badge to built-in rows.
- Any per-pack purchase/checkout flow; naming the required tier in copy; role-differentiated copy.
- Server-decorated `entitled` flags on station/portal payloads (D1 option C).

---

## Surface

### 1. `apps/web/src/utils/tool-packs.util.ts` (edit)

Additions alongside the existing `ToolPackUtil.getLabel`:

```ts
/** Every built-in slug, the permissive fallback set (Q1 — fail open). */
export const ALL_BUILTIN_SLUGS: ReadonlySet<string> = new Set(
  BuiltinToolpackSlugSchema.options
);

/**
 * Is this pack reference available on the org's plan?
 *
 * Governs the BUILT-IN axis only. A custom ref (`org:<uuid>`) or any
 * unrecognized string returns `true` — the custom axis is #214's
 * `customToolpacks` boolean and is not this predicate's business.
 */
export function isBuiltinPackEntitled(
  pack: string,
  entitledSlugs: ReadonlySet<string>
): boolean;

/** The subset of `packs` that are built-in slugs outside `entitledSlugs`, input order preserved. */
export function unentitledBuiltins(
  packs: readonly string[],
  entitledSlugs: ReadonlySet<string>
): string[];
```

Copy constants (single source; every surface reads these, no inline strings):

```ts
export const UNENTITLED_PACK_BADGE = "Inactive on your plan";
export const UNENTITLED_PACK_REASON = "Not included in your plan";
export const UNENTITLED_PACK_TOOLTIP =
  "This tool pack isn't included in your plan, so its tools are unavailable in portal sessions.";
export const UPGRADE_CTA_LABEL = "View plans";
```

`UNENTITLED_PACK_BADGE` deliberately reuses #214's existing custom-axis string (`Toolpacks.view.tsx:152`) so both axes badge identically; that literal moves into this constant and the view imports it.

### 2. `apps/web/src/utils/use-builtin-entitlements.util.ts` (new)

```ts
export interface BuiltinEntitlements {
  /** Entitled built-in slugs; ALL_BUILTIN_SLUGS while the query has no data. */
  entitledSlugs: ReadonlySet<string>;
  /** Curried `isBuiltinPackEntitled` over `entitledSlugs`. */
  isEntitled: (pack: string) => boolean;
  /** True until the usage query resolves. Informational — the fallback is already permissive. */
  isLoading: boolean;
}

export function useBuiltinEntitlements(): BuiltinEntitlements;
```

Implementation contract: reads `sdk.organizations.usage()` — the same cache entry `Settings.view.tsx:90`, `Toolpacks.view.tsx:367`, and `Portal.view.tsx:146` already hold, so **zero additional fetches** — and falls back to `ALL_BUILTIN_SLUGS` when `data` is absent for any reason (loading, error, offline). Mirrors #214's `?? true` posture exactly.

### 3. `packages/core` — per-option disabling

**`packages/core/src/ui/searchable-select/types.ts`** — `SelectOption` gains:

```ts
  /** Rendered under the label when `disabled` is true. Ignored otherwise. */
  disabledReason?: string;
```

**`packages/core/src/ui/searchable-select/MultiSearchableSelect.tsx`** — the declared-but-ignored `SelectOption.disabled` becomes real:

- `getOptionDisabled={(option) => option.disabled === true}` on the `MuiAutocomplete`.
- The existing `renderOption` (`:46`) renders `option.disabledReason` as a second line (`Typography variant="caption" color="text.secondary"`) and sets `aria-disabled="true"` on the `li` when disabled.
- `renderTags` is **unchanged**: an already-selected value whose option is now disabled still renders and stays deletable. Downgrade must never trap a station's existing selection.

No new props on `MultiSearchableSelectProps`.

### 4. Station pickers

**`apps/web/src/components/CreateStationDialog.component.tsx`** — `CreateStationDialogProps` gains `entitledBuiltinSlugs?: ReadonlySet<string>` (default `ALL_BUILTIN_SLUGS`). The MUI `Autocomplete` (`:203`) gains:

- `getOptionDisabled={(o) => !isBuiltinPackEntitled(o, entitledBuiltinSlugs)}`
- `renderOption` (new — the component currently relies on the default) rendering label + `UNENTITLED_PACK_REASON` for disabled options.

The dialog's container call site supplies the set from `useBuiltinEntitlements()`.

**`apps/web/src/components/EditStationDialog.component.tsx`** — same prop. `BUILTIN_TOOL_PACK_OPTIONS` (`:32`, module-level today) becomes a `useMemo` over the entitled set, marking unentitled entries `disabled: true, disabledReason: UNENTITLED_PACK_REASON`. `MultiSearchableSelect` needs no prop change (D3).

Both dialogs keep `toolPacks` validation as-is: an already-attached unentitled slug still counts toward `min(1)`.

### 5. Chips

**`apps/web/src/components/ToolPackChip.component.tsx`** — `ToolPackChipProps` gains `entitled?: boolean` (default `true`). When `false`:

- `variant="outlined"`, `sx={{ opacity: 0.6, borderStyle: "dashed" }}`
- wrapped in `<Tooltip title={UNENTITLED_PACK_TOOLTIP}>`
- `aria-label={`${label} — ${UNENTITLED_PACK_REASON}`}` and `data-entitled="false"` (the test/story hook)

Label text is unchanged — the pack is still named. Default-`true` keeps every current call site and its tests green.

**`apps/web/src/components/ToolPackChipWithMetadata.component.tsx`** — `ToolPackChipWithMetadataUIProps` and `ToolPackChipWithMetadataProps` both gain `entitled?: boolean` (default `true`), forwarded to `ToolPackChip` **and** to the modal. The container also reads `useBuiltinEntitlements()` so a caller that passes nothing still renders truthfully.

**`ToolpackMetadataModal.component.tsx`** — `ToolpackMetadataModalUIProps` gains `entitled?: boolean` (default `true`). When `false`, an `<Alert severity="info">` renders directly above `toolpack.description` inside `DialogContent`, carrying `UNENTITLED_PACK_TOOLTIP` and the upgrade link. The tool list still renders — the modal documents what the pack *does*; the alert states it is unavailable.

**Wiring the four chip surfaces** (all read `station.enabledToolpacks`):

| Surface | Change |
|---|---|
| `StationDetail.view.tsx:211` | `entitled={isEntitled(pack)}` from the hook (view-level container). |
| `Portal.view.tsx:200` | Same; the view already holds `usage()` at `:146` — no new query. |
| `StationList.component.tsx:124` | `StationListUIProps` gains `entitledBuiltinSlugs?: ReadonlySet<string>`; `StationListConnected` (`:197`) supplies it. |
| `DefaultStationCard.component.tsx:118` | `DefaultStationCardUIProps` gains the same; `DefaultStationCardConnected` (`:141`) supplies it. |

### 6. `/toolpacks`

**`apps/web/src/views/Toolpacks.view.tsx`** —

- `ToolpackRow` gains `slug: string` (populated at `:248-259`); the kind column's `render` reads `row.slug`.
- `ToolpacksUIProps` gains `entitledBuiltinSlugs?: ReadonlySet<string>` (default `ALL_BUILTIN_SLUGS`).
- Badge condition becomes: `kind === "custom" ? !customToolpacksEntitled : !isBuiltinPackEntitled(row.slug, entitledBuiltinSlugs)`; both render the same `UNENTITLED_PACK_BADGE` chip.
- `ToolpackMetadataModalUI` (`:343`) receives `entitled={selected ? isEntitled(selected.slug) : true}`.
- The container reads the built-in set from the same `usageResult` it already holds for `customToolpacksEntitled` (`:367`).

### 7. The upgrade target

**`apps/web/src/utils/routes.util.ts`** (edit):

```ts
export enum SettingsTab {
  Profile = "profile",
  Organization = "organization",
  Billing = "billing",
}

export const SETTINGS_TAB_INDEX: Record<SettingsTab, number> = {
  [SettingsTab.Profile]: 0,
  [SettingsTab.Organization]: 1,
  [SettingsTab.Billing]: 2,
};

/** Resolve `?tab=` to a tab index; unknown/absent → 0. */
export function settingsTabIndexFromSearch(search: string): number;
```

**`apps/web/src/routes/settings.tsx`** gains `validateSearch` declaring `tab?: SettingsTab` (the first `validateSearch` in the app — the `?billing=` reader stays as-is on `window.location`, untouched).

**`apps/web/src/views/Settings.view.tsx`** — `useTabs()` (`:41`) becomes `useTabs(settingsTabIndexFromSearch(window.location.search))`. Seeding at mount only; the param is not kept in sync as the user clicks tabs.

**One shared link component** — `apps/web/src/components/UpgradeLink.component.tsx` (new, pure UI, no props required): a MUI `Link` wrapping TanStack `Link to={ApplicationRoute.Settings} search={{ tab: SettingsTab.Billing }}` labeled `UPGRADE_CTA_LABEL`. Rendered by the chip tooltip, the modal alert, and the picker reason line so all surfaces agree by construction.

### 8. `apps/api/src/services/entitlement.service.ts` (new)

One definition of "effective", consumed by four call sites.

```ts
export interface BuiltinPackSplit {
  /** Configured ∩ entitled — what actually exists in the session. */
  effective: string[];
  /** Configured \ entitled — configured, stripped, and now nameable. */
  unentitled: string[];
  /** The tier slug that resolved (for logs and denial messages). */
  tier: string;
}

export class EntitlementService {
  /** Resolve the org's tier and split its configured built-in slugs. Input order preserved. */
  static async splitBuiltinPacks(
    organizationId: string,
    configuredSlugs: readonly string[]
  ): Promise<BuiltinPackSplit>;

  /** True when the org's tier entitles custom (webhook) toolpacks. */
  static async customPacksEntitled(organizationId: string): Promise<boolean>;
}
```

Behavior, lifted verbatim from `tools.service.ts:429-449` so the refactor is behavior-preserving:

- `repo.organizations.findById(organizationId)` → `TierService.resolveTier(org ?? { tier: "" })` (unknown/missing org falls back to the default tier's entitlements).
- Allowlist entries unknown to `BuiltinToolpackSlugSchema` are ignored with the existing `logger.warn` ("Tier allowlist carries slugs unknown to the toolpack registry; ignoring them").
- **Fail-closed by shape:** an unresolvable policy throws, exactly as today — a DB outage already fails whatever it was serving.

`tools.service.ts:429-449` is refactored to call `splitBuiltinPacks` and keep `effective` as its `toolPacks`. Its existing guard tests (`tools.service.test.ts:1231-1420`, including "a station whose every configured pack is unentitled builds system tools only — no throw" at `:1343`) are the regression net and must not change.

### 9. Station write guard

**`apps/api/src/constants/api-codes.constants.ts`** — in the Toolpacks block, beside `TOOLPACK_NOT_ENTITLED` (`:240`):

```ts
  /** A station write tried to attach a built-in pack the org's tier doesn't entitle (#284). 403. */
  STATION_TOOLPACK_NOT_ENTITLED = "STATION_TOOLPACK_NOT_ENTITLED",
```

**`apps/api/src/routes/station.router.ts`** — a local async helper beside `parseToolpackRefs`:

```ts
/**
 * Reject built-in slugs the org's tier doesn't entitle. Runs over
 * NEWLY ADDED slugs only — already-persisted unentitled packs are
 * tolerated so a downgrade never freezes a station (#284 D5).
 * Returns null when everything is allowed.
 */
async function denyUnentitledBuiltins(
  organizationId: string,
  newBuiltinSlugs: string[]
): Promise<ApiError | null>;
```

- **Empty input short-circuits** — a rename-only PATCH resolves no tier and issues no query.
- Otherwise `EntitlementService.splitBuiltinPacks(organizationId, newBuiltinSlugs)`; `unentitled.length > 0` →
  `logger.warn({ organizationId, tier, denied }, "Station write denied unentitled built-in toolpacks")`
  and `new ApiError(403, ApiCode.STATION_TOOLPACK_NOT_ENTITLED, \`Tool pack${s} not included in your plan: ${denied.join(", ")}\`)`.

**POST `/` (`:365-415`)** — after the `parseToolpackRefs` check, before `stations.create`: every `refs.builtinSlugs` entry is new, so the guard runs over the whole set. Ordering matters: **no station row and no toolpack rows are written when the guard denies.** The `["data_query"]` default (`:385`) is inside the guarded set; safe only because every tier entitles it — pinned by §11.

**PATCH `/:id` (`:545-612`)** — when `toolPacks !== undefined`, after `parseToolpackRefs` and before `stations.update`:

```ts
const existingRows = await DbService.repository.stationToolpacks.findByStationId(id);
const existingBuiltins = new Set(
  existingRows.map((r) => r.builtinSlug).filter((s): s is string => s !== null)
);
const newlyAdded = refs.builtinSlugs.filter((s) => !existingBuiltins.has(s));
```

Same call GET already makes at `:270`. A payload that re-sends an existing unentitled slug adds nothing → allowed. Removing an unentitled slug is always allowed; re-adding it later is a new attach → denied.

**`@openapi`** — both blocks gain a `403` response `$ref: '#/components/schemas/ApiErrorResponse'` described as "Tool pack not included in the organization's plan", modeled on `toolpacks.router.ts:289`.

### 10. Agent legibility

**`StationContext`** (`apps/api/src/prompts/system.prompt.ts:33-49`):

```ts
  /** Configured ∩ entitled — the packs whose tools EXIST in this session. */
  effectiveToolPacks: string[];
  /** Configured \ entitled — configured, stripped, and nameable to the user. */
  unentitledToolPacks: string[];
```

`toolPacks` is **removed** (renamed, not aliased). All 6 read sites in `system.prompt.ts` (`:144`, `:221-222`, `:322`, `:393`, `:440`) move to `effectiveToolPacks`.

**`buildStationContext`** (`portal.service.ts:1017-1046`) keeps its `toolPacks: string[]` argument — callers still pass the station's **configured** packs — and splits internally via `EntitlementService.splitBuiltinPacks`. Consequently the two `toolPacks.includes("entity_management")` gates at `:1026` and `:1031` key off `effective`: an unentitled `entity_management` station no longer loads `entityCapabilities` or `connectorInstances` it can't use. Callers unchanged (`portal.service.ts:328`, `portal-events.router.ts:100`).

**`station_context` tool** (`apps/api/src/tools/station-context.tool.ts`) — `StationContextResponse` gains:

```ts
  /**
   * The station's tool packs, split by what the organization's plan
   * includes. `effective` packs have live tools; `unentitled` packs are
   * attached to the station but excluded by the plan — their tools do
   * not exist in this session.
   */
  toolPacks?: {
    effective: string[];
    unentitled: string[];
  };
```

`"toolPacks"` joins the `include` enum (`:37-45`) and the default section set (`:145-153`). The tool resolves it itself: `stationToolpacks.findByStationId(stationId)` → `EntitlementService.splitBuiltinPacks`. The tool `description` gains one clause naming the section, since the agent must know it can ask.

**Prompt capability surface (D8)** — new declared map in `system.prompt.ts`:

```ts
interface PackPromptSection {
  /** Verb phrase for the role intro's capability list, e.g. "render visualizations". */
  capability: string;
  /** Rendered-block nouns for Response Style, e.g. ["charts"]. */
  blocks: string[];
  /** Tools whose output needs an interpretive sentence, e.g. ["hypothesis_test"]. */
  interpretiveTools: string[];
  /** Strings that must appear IFF this pack is effective — the guard test's assertion set. */
  markers: string[];
  /** The pack's guidance block. `[]` is a legal, explicit "needs none". */
  render: (ctx: StationContext) => string[];
}

const PACK_PROMPT_SECTIONS: Record<BuiltinToolpackSlug, PackPromptSection>;
```

Exhaustive over the slug union — adding an eighth slug to `BuiltinToolpackSlugSchema` **fails `type-check`** until it declares an entry.

Behavior this pins:

- **Every existing gated block is preserved as-is**, moved under its owning slug: Entity Management Notes + "Creating a new entity" → `entity_management`; SQL Guidance + Schema Introspection → shared by `data_query`/`visualize` exactly as today (`:220-222`); Charting → `visualize`.
- **Cross-cutting prose is assembled, never hardcoded.** The role intro's capability list (`:62-92`), the routing bullet's enumeration, Response Style's block list (`:458-462`), and the interpretive-tools sentence (`:487-492`) are built from the effective packs' `capability` / `blocks` / `interpretiveTools`. With zero effective packs the intro degrades to the pack-free form (the tool-caller role, the fabrication prohibitions, and the "no tool fits" guidance all still render — they are pack-independent).
- **`capability` phrases are pairwise distinct and non-substring**, so a marker for one pack can never be satisfied by another's prose. Pinned by test.
- **A new `## Not Included In This Plan` block** renders iff `unentitledToolPacks.length > 0`: names the packs, states their tools are unavailable *in this session*, instructs the agent to say the plan doesn't include the capability and to point at Settings → Subscription & Billing, and forbids both describing it as a missing product capability and substituting another tool.
- **The "If no tool fits" bullet (`:86-89`) becomes three-way:** capability is effective → call the tool; configured-but-unentitled → the plan branch above; neither → the station doesn't have it, with no plan framing (upgrading wouldn't help).

### 11. `tier-catalog.ts` invariant

No code change. `packages/core/src/__tests__/registries/tier-catalog.test.ts` gains the assertion that every `TIER_CATALOG` entry's `builtinToolpacks` contains `data_query`, so POST's implicit default can never be denied by its own guard.

### 12. Doc-sync

- `apps/web/src/utils/glossary.util.ts` — a "Tool pack entitlement" term defining the configured-vs-effective split and the badge copy.
- `apps/web/src/utils/faq.util.ts` — "Why is a tool pack on my station greyed out / why can't the assistant use it?"
- `packages/core/src/registries/builtin-toolpacks.ts` — untouched (no pack description changes), so no mirror update.

## Migration

**None.** No schema change: `tiers.builtin_toolpacks` and `station_toolpacks` already exist and neither gains a column. No `db:generate`, no backfill, no retroactive strip.

## Seed

**None.** `tier-catalog.ts` values are unchanged; `tier apply` is not re-run for this ticket.

## TDD test plan

Per-package npm scripts only — never raw jest/npx (missing `NODE_OPTIONS` breaks ESM).

### `packages/core` — `npm run test:unit`

`src/__tests__/ui/MultiSearchableSelect.test.tsx` (+4)
- a `disabled: true` option renders `aria-disabled` and is not selectable on click
- `disabledReason` renders under the label; absent when the option is enabled
- an already-selected value whose option is now disabled still renders as a tag **and is deletable**
- enabled options are unaffected (regression on the shipped behavior)

`src/__tests__/registries/tier-catalog.test.ts` (+1)
- every catalog entry entitles `data_query`

**≈ 5 cases.**

### `apps/web` — `npm run test:unit`

`src/__tests__/ToolPackUtil.test.ts` (+5)
- entitled built-in → `true`; unentitled built-in → `false`
- `org:<uuid>` ref → `true` regardless of the set (built-in axis only)
- unrecognized string → `true`
- `unentitledBuiltins` returns only unentitled built-ins, input order preserved

`src/__tests__/useBuiltinEntitlements.test.tsx` (new, +3)
- resolved query → the tier's slug set
- no data (loading) → `ALL_BUILTIN_SLUGS`, `isLoading: true`
- query error → `ALL_BUILTIN_SLUGS` (fail open, Q1)

`src/__tests__/CreateStationDialog.test.tsx` (+3) · `src/__tests__/EditStationDialog.test.tsx` (+3)
- unentitled option renders with `UNENTITLED_PACK_REASON` and is not selectable
- entitled options select normally
- (Edit) an already-attached unentitled slug stays in `value` and can be removed

`src/__tests__/ToolPackChip.test.tsx` (+3)
- default (no prop) renders exactly as today
- `entitled={false}` → `data-entitled="false"`, tooltip copy, `aria-label` naming the limit
- label text is unchanged when unentitled

`src/__tests__/ToolPackChipWithMetadataUI.test.tsx` (+2) — forwards `entitled` to chip and to modal

`src/__tests__/ToolpackMetadataModal.test.tsx` (+2) — alert + upgrade link when `entitled={false}`; neither when `true`

`src/__tests__/Toolpacks.view.test.tsx` (+3)
- unentitled built-in row is badged; entitled built-in row is not
- the custom-axis badge still behaves per #214 (regression)
- the modal for an unentitled built-in row receives `entitled={false}`

`src/__tests__/StationList.test.tsx` (+1) · `src/__tests__/DefaultStationCard.test.tsx` (+1) — chip renders inert from the UI prop

`src/__tests__/SettingsView.test.tsx` (+3) — `?tab=billing` mounts tab 2; no param → 0; unknown value → 0

**≈ 29 cases.**

### `apps/api` — `npm run test:unit`

`src/__tests__/services/entitlement.service.test.ts` (new, +5)
- splits configured into effective/unentitled, order preserved
- unknown allowlist slug is ignored with a warn
- missing org row falls back to the default tier
- empty configured input → both lists empty, no throw
- `customPacksEntitled` reflects the tier

`src/__tests__/prompts/system.prompt.test.ts` (+9)
- **GUARD (iff-effective):** `it.each(BuiltinToolpackSlugSchema.options)` — with only that slug effective, all its `markers` appear; with every *other* slug effective, none of them do
- `capability` phrases are pairwise distinct and non-substring
- a configured-but-unentitled pack contributes **no** markers (the reported bug, as a test)
- `## Not Included In This Plan` renders with the pack names + the billing path when `unentitledToolPacks` is non-empty
- …and is absent when it is empty
- zero effective packs → no capability enumeration, but role/prohibitions/"no tool fits" still render
- the "no tool fits" guidance carries all three branches
- Response Style's block list and interpretive-tools sentence name only effective packs' entries
- existing pins updated for `effectiveToolPacks` (rename mechanical, assertions unchanged)

`src/__tests__/services/portal.service.test.ts` (+3)
- `buildStationContext` returns effective/unentitled from configured input
- an unentitled `entity_management` loads neither `entityCapabilities` nor `connectorInstances`
- an entitled one still loads both (regression)

`src/__tests__/tools/station-context.tool.test.ts` (+3)
- `toolPacks` section present by default with both lists
- excluded when `include` omits it
- an unentitled configured pack appears in `unentitled`, not `effective`

`src/__tests__/services/tools.service.test.ts` (+1)
- delegating to `EntitlementService` leaves the existing entitlement guard tests (`:1231-1420`) passing unchanged

**≈ 21 cases.**

### `apps/api` — `npm run test:integration`

`src/__tests__/__integration__/routes/station.router.integration.test.ts` (+6)
- POST with an unentitled built-in → `403 STATION_TOOLPACK_NOT_ENTITLED`, **no station row and no toolpack rows created**
- POST with no `toolPacks` (the `["data_query"]` default) → 201 on the `standard` tier
- PATCH adding an unentitled built-in → 403, no toolpack rows changed
- PATCH renaming a station that already carries an unentitled built-in, `toolPacks` omitted → 200
- PATCH re-sending the same set including an already-persisted unentitled slug → 200
- PATCH removing an unentitled slug → 200; a follow-up PATCH re-adding it → 403

**≈ 6 cases.**

**Totals ≈ 61 cases.** No migration test (no migration). No new seed test.

## Acceptance criteria

- [ ] On a `standard`-tier org, Create Station and Edit Station both show `entity_management` present, unselectable, with a visible reason.
- [ ] `/toolpacks` badges unentitled built-in rows and leaves entitled ones unbadged; the custom-axis badge is unchanged.
- [ ] The pack modal for an unentitled built-in states the limit and offers the upgrade path; for an entitled one it is unchanged.
- [ ] Reason copy and upgrade link are byte-identical for an owner and a non-owner; no surface reads `organization.ownerUserId`.
- [ ] A station already carrying `entity_management` on `standard` shows that chip inert in station detail, portal header, station list, and default-station card.
- [ ] Every unentitled affordance links to `/settings?tab=billing`, which opens on Subscription & Billing.
- [ ] `POST /api/stations` with an unentitled built-in returns `403 STATION_TOOLPACK_NOT_ENTITLED` and creates nothing.
- [ ] `PATCH /api/stations/:id` adding an unentitled built-in returns 403; a rename-only PATCH on an already-unentitled station returns 200.
- [ ] Upgrading a tier makes the pack's tools appear in the next portal session with no re-attach.
- [ ] Asked to create entities on a configured-but-unentitled `entity_management` station, the agent names the plan limit and the upgrade path — not a product gap.
- [ ] On a station whose effective set excludes `visualize`, the agent never offers, promises, or describes charting; asked to chart, it names the plan limit rather than substituting a table.
- [ ] Asked "what can you do here?", the agent enumerates only effective-pack capabilities.
- [ ] Moving a pack between tiers in `tier-catalog.ts` changes the agent's claims with **no prompt edit**; adding a slug to `BuiltinToolpackSlugSchema` fails `type-check` until its section is declared and fails the guard test until it is gated.
- [ ] A station whose every configured pack is unentitled still builds a session (system tools only) — `tools.service.ts:415-427` behavior preserved.
- [ ] A stale or failed `usage()` query never disables a legitimate affordance (fail open); the server guard never permits an attach it cannot justify (fail closed).

## Risks & rollback

| Risk | Detection | Mitigation / rollback |
|---|---|---|
| The `effectiveToolPacks` rename misses a read site, silently dropping a prompt section | `type-check` fails on every missed site (the field is removed, not aliased) | Compile-time; nothing to roll back |
| Assembled cross-cutting prose reads worse than the hand-written sentences | Smoke: read the rendered prompt for a 1-pack and a 5-pack station | Phrases are data in `PACK_PROMPT_SECTIONS`; reword without touching structure |
| The PATCH diff wrongly denies a legitimate write (e.g. a set-equal payload) | Integration cases 4–6 above; the 403 `warn` log carries org, tier, denied slugs | Guard is one helper call in each handler — revert the two call sites, keep the surfacing |
| Fail-open UI briefly offers an unentitled pack on a slow `usage()` | Server guard returns 403 with readable copy | Accepted (Q1): the alternative silently forbids legitimate work |
| A tier row edited to drop `data_query` breaks the POST default | `tier-catalog.test.ts` invariant (§11) covers the catalog; a hand-edited DB row is not covered | Documented in the invariant's comment; #218's `tier apply` is the sanctioned write path |
| `validateSearch` on `/settings` (the app's first) interacts with the `?billing=` `replaceState` strip | `SettingsView.test.tsx` billing cases must stay green | The two params are read independently; revert to a `window.location`-only read if it misbehaves |

Fail-mode statement (carried from discovery): **UI fails open, server fails closed.** The UI is an honesty affordance, not a gate; the server guard is the gate, and a guard that fails open would reintroduce exactly the silent state this ticket removes. The check-then-act race (tier downgrade landing mid-PATCH) is accepted and unlocked: the raced outcome is a slug that is inert at the next session build — the tolerated downgrade state, not a monetary error.

## Files touched

**New**
- `apps/web/src/utils/use-builtin-entitlements.util.ts`
- `apps/web/src/components/UpgradeLink.component.tsx`
- `apps/api/src/services/entitlement.service.ts`
- `apps/web/src/__tests__/useBuiltinEntitlements.test.tsx`
- `apps/api/src/__tests__/services/entitlement.service.test.ts`

**Edited — core**
- `packages/core/src/ui/searchable-select/types.ts`, `MultiSearchableSelect.tsx`
- `packages/core/src/__tests__/ui/MultiSearchableSelect.test.tsx`, `__tests__/registries/tier-catalog.test.ts`

**Edited — web**
- `utils/tool-packs.util.ts`, `utils/routes.util.ts`, `routes/settings.tsx`
- `components/CreateStationDialog.component.tsx`, `EditStationDialog.component.tsx`
- `components/ToolPackChip.component.tsx`, `ToolPackChipWithMetadata.component.tsx`, `ToolpackMetadataModal.component.tsx`
- `components/StationList.component.tsx`, `DefaultStationCard.component.tsx`
- `views/Toolpacks.view.tsx`, `StationDetail.view.tsx`, `Portal.view.tsx`, `Settings.view.tsx`
- `utils/glossary.util.ts`, `utils/faq.util.ts`
- tests: `ToolPackUtil.test.ts`, `CreateStationDialog.test.tsx`, `EditStationDialog.test.tsx`, `ToolPackChip.test.tsx`, `ToolPackChipWithMetadataUI.test.tsx`, `ToolpackMetadataModal.test.tsx`, `Toolpacks.view.test.tsx`, `StationList.test.tsx`, `DefaultStationCard.test.tsx`, `SettingsView.test.tsx`
- stories: `ToolPackChip`, `ToolpackMetadataModal` (unentitled variants)

**Edited — api**
- `constants/api-codes.constants.ts`, `routes/station.router.ts`
- `services/tools.service.ts` (delegate to `EntitlementService`), `services/portal.service.ts`
- `prompts/system.prompt.ts`, `tools/station-context.tool.ts`
- tests: `prompts/system.prompt.test.ts`, `services/portal.service.test.ts`, `services/tools.service.test.ts`, `tools/station-context.tool.test.ts`, `__integration__/routes/station.router.integration.test.ts`

## Next step

`docs/BUILTIN_TOOLPACK_ENTITLEMENT_SURFACING.plan.md` sequences this into **4 slices, each a testable commit on this branch** (no child ticket): (1) plumbing — core option-disable + predicate + hook + `?tab=billing` + `UpgradeLink` (≈10 cases); (2) display surfaces — both pickers, `/toolpacks` badge + modal, four chips (≈19); (3) server enforcement — `EntitlementService`, the `ApiCode`, both 403s + `@openapi`, the catalog invariant, integration cases (≈13); (4) agent legibility — the `effectiveToolPacks` rename, `station_context` output, `PACK_PROMPT_SECTIONS` with the iff-effective guard, the three-way branch, doc-sync (≈19). Slice 4 is the largest and carries the reported bug's fix; slices 1–3 are independently mergeable if it needs a second pass.
