# Station notice for plan-excluded packs — Spec

This spec pins the contract for #1055: the web classifies a station the way the API does, and when the plan excludes every pack whose tools would read the station's records, the attachment notice names those packs and links to plans. It does not tell the user to attach a view. Discovery: [`PLAN_EXCLUDED_PACKS_NOTICE.discovery.md`](PLAN_EXCLUDED_PACKS_NOTICE.discovery.md) · Issue: [#1055](https://github.com/EnterpriseBT/portal-ai/issues/1055).

## Key decisions (flag for review)

1. **The notice names packs.** Packs are only ever built-in or custom, so the copy names the excluded packs ("GIS isn't included…") rather than describing a kind of pack.
2. **The classification moves to `@portalai/core/registries`** unchanged, with no re-export from `apps/api`.
3. **The web computes the state** from the station's `enabledToolpacks` and the plan entitlements it already loads. There's no API response change.
4. **One notice, one wording source.** `describeStationAttachmentGaps` gains an optional second argument. `none` keeps today's text (#848).
5. **Fail open.** While entitlements load or if they fail, the state is `usable`, which shows today's text. The plan message never appears on missing data.
6. **The API's prompt and `platform_help` keep their inputs and output.** Only their import path changes.

## Scope

### In scope
- Move the classification module to core. The API imports it from there.
- Add the `dataSetup` / `excludedPackNames` option and the plan sentence to `describeStationAttachmentGaps`.
- Add a web helper that derives the state and names, and a `customPacksEntitled` flag on `useBuiltinEntitlements`.
- `StationAttachmentAlertsUI` renders the plan sentence and the "View plans" link, on the station page and the portal header.

### Out of scope
- Chips for `org:` refs, and marking excluded custom packs inactive (#1063).
- The `none` wording (#848). The system prompt and `platform_help` text.
- A station response field for the state.

## Surface

### `packages/core/src/registries/station-data-packs.ts` (new; moved from `apps/api/src/utils/station-data-packs.util.ts`)

The body moves verbatim:

```ts
import { isBuiltinToolpackSlug, type BuiltinToolpackSlug } from "./builtin-toolpacks.js";
export const PACK_USES_STATION_DATA: Record<BuiltinToolpackSlug, boolean>;
export type StationDataSetup = "usable" | "plan-excluded" | "none";
export function stationDataSetup(packs: {
  effective: readonly string[]; unentitled: readonly string[];
  hasUsableCustomPack: boolean; hasExcludedCustomPack: boolean;
}): StationDataSetup;
export function usesStationData(builtinSlugs: readonly string[], hasCustomPack: boolean): boolean;
```

- Exported from `packages/core/src/registries/index.ts` (`export * from "./station-data-packs.js";`).
- `apps/api/src/utils/station-data-packs.util.ts` is deleted.
- `system.prompt.ts:23` and `platform-help.tool.ts:24` import from `@portalai/core/registries`.

### `describeStationAttachmentGaps` (`packages/core/src/content/station-attachments.util.ts:44`)

```ts
export interface StationAttachmentGapsOptions {
  /** Mirrors `StationDataSetup` (@portalai/core/registries); content can't import it. */
  dataSetup?: "usable" | "plan-excluded" | "none";
  /** Display names of the plan-excluded packs whose tools read station records. */
  excludedPackNames?: readonly string[];
}
export function describeStationAttachmentGaps(
  c: StationAttachmentCounts,
  options?: StationAttachmentGapsOptions
): StationAttachmentGaps;
```

- **Omitted, `usable` or `none`:** `missing` and `noAccess` are exactly today's output.
- **`plan-excluded`:** `missing` is the plan sentence, whatever the counts. `noAccess` is unchanged.
- **The plan sentence** is `` `${list} ${verb} included in your plan, so attaching a view won't make data available on this station.` ``.
  - `verb` is `isn't` for one name and `aren't` for more.
  - `list` joins up to four names (`A`; `A and B`; `A, B and C`; `A, B, C and D`). Beyond four it names three and adds `and N more` (N ≥ 2). In a cut list, the organization's packs always take the third place, so they are never folded into the count (code review).
  - If `excludedPackNames` is empty or missing, the list is `Some tool packs on this station`, with `aren't`.
- A new exported constant `STATION_PLAN_EXCLUDED_CUSTOM_PACKS = "Your organization's tool packs"`. Callers pass it as a name, and it reads lowercase `your organization's tool packs` when it isn't first.

### Web: `apps/web/src/utils/tool-packs.util.ts`

```ts
export function stationDataSetupFor(
  enabledToolpacks: readonly string[],
  isEntitled: (pack: string) => boolean,
  customPacksEntitled: boolean
): { dataSetup: StationDataSetup; excludedPackNames: string[] };
```

- **Built-in refs** are split into `effective` (entitled) and `unentitled`.
- **Custom refs:** `hasCustom` is true when any ref isn't a built-in slug (an `org:` ref).
  - `hasUsableCustomPack` is `hasCustom && customPacksEntitled`.
  - `hasExcludedCustomPack` is `hasCustom && !customPacksEntitled`.
- **The state** comes from core's `stationDataSetup`.
- **`excludedPackNames`** is the unentitled built-ins with `PACK_USES_STATION_DATA` true, in the station's `enabledToolpacks` order (as its chips show them), by `BUILTIN_TOOLPACK_BY_SLUG[slug].name`. If `hasExcludedCustomPack`, `STATION_PLAN_EXCLUDED_CUSTOM_PACKS` is appended. It is empty unless the state is `plan-excluded`.

### Web: `useBuiltinEntitlements` (`apps/web/src/utils/use-builtin-entitlements.util.ts:35`)

`BuiltinEntitlements` gains `customPacksEntitled: boolean`, read from `usage().data?.tier?.entitlements?.customToolpacks`. It's `true` when absent (fail open, like the built-in set).

### Web: `StationAttachmentAlertsUI` (`apps/web/src/components/StationAttachmentAlerts.component.tsx`)

- **Props** gain `dataSetup?: StationDataSetup` (default `"usable"`) and `excludedPackNames?: readonly string[]`.
- **`plan-excluded`:** it renders the same `info` outlined `Alert`, with the plan sentence followed by `<UpgradeLink />` ("View plans" → `/settings?tab=billing`).
- **Other states:** rendering is unchanged.
- **Callers:**
  - `StationDetail.view.tsx:295` passes the helper's result.
  - `PortalHeaderMetaUI` gains a `customPacksEntitled` prop beside `isEntitled`, and its container passes it.

## Migration / Seed

None. No schema or seed change.

## TDD test plan

### Core: `npm run test:unit` in `packages/core`
- `__tests__/registries/station-data-packs.test.ts`: the moved #848/#1045 cases from `apps/api/src/__tests__/utils/station-data-packs.util.test.ts`, unchanged (exhaustive table; usable / plan-excluded / none; custom flags). ≈ 9 cases.
- `__tests__/content/station-attachments.util.test.ts`, new cases:
  - each option value leaves the old output untouched;
  - `plan-excluded` with counts 0/0 and with both attached;
  - names: 1 (`isn't`), 2, 3, 5 (`and 2 more`);
  - an empty list falls back;
  - the custom constant first and not first (lowercase);
  - `noAccess` is unchanged.
  - ≈ 10 cases.
- A type test that `NonNullable<StationAttachmentGapsOptions["dataSetup"]>` equals `StationDataSetup`, in the registries test file (registries can import content). 1 case.
- Content purity stays green: no import is added to `content/`.

### API: `npm run test:unit` in `apps/api`
- The moved test file is deleted.
- `__tests__/prompts/system.prompt.test.ts` and `__tests__/tools/platform-help.tool.test.ts` pass unchanged, proving the output is the same.

### Web: `npm run test:unit` in `apps/web`
- `__tests__/ToolPackUtil.test.ts` (`stationDataSetupFor`):
  - all entitled → `usable`;
  - only GIS + Curated Views with GIS excluded → `plan-excluded` / `["GIS"]`;
  - Web Search only → `none`;
  - an excluded custom pack and no other pack that reads data → `plan-excluded` / `["Your organization's tool packs"]`;
  - an entitled custom pack → `usable`;
  - the name order follows the station's own order.
  - ≈ 6 cases.
- `__tests__/StationAttachmentAlerts.test.tsx`:
  - the plan sentence and the "View plans" link to `/settings?tab=billing` in `plan-excluded`;
  - no "Attach a view" text;
  - unchanged otherwise;
  - axe on the plan state.
  - ≈ 4 cases.
- `__tests__/useBuiltinEntitlements.test.tsx`: `customPacksEntitled` follows the payload and fails open. ≈ 2 cases.
- `__tests__/StationDetail.view.test.tsx` and `PortalHeaderMeta.component.test.tsx`: a station whose only packs the plan excludes shows the plan notice. ≈ 2 cases.

**Totals ≈ 34 cases** (≈ 9 moved).

## Acceptance criteria

- **The repro.** A station with GIS + Curated Views, a connector and no views, on a plan without GIS:
  - the station page and the portal header say "GIS isn't included in your plan, so attaching a view won't make data available on this station." followed by "View plans";
  - neither says "Attach a view".
- "View plans" opens Settings on Subscription & Billing.
- With any pack on the station that reads data and is included in the plan, the notice reads exactly as today.
- A station with no such packs at all (Administrate) reads exactly as today.
- While the plan is loading, the notice reads as today and never flashes the plan sentence.
- The assistant and `platform_help` answers are unchanged.

## Risks & rollback

- **The move breaks an API import.** Type-check and the API suites catch it at build.
- **The chips and the notice disagree.** Both read `useBuiltinEntitlements`, which removes the main source of disagreement.
- **A dangling `org:` ref reads `plan-excluded` on the page but `none` in the assistant.** It's accepted and rare (see discovery Q2). #1063 resolves it.
- **Fail-open cost.** At worst a user sees today's "attach a view" advice while the plan loads. It never shows a false plan claim.
- **Rollback.** Revert the PR. There's no data or contract to undo.

## Files touched

- **New:**
  - `packages/core/src/registries/station-data-packs.ts`
  - `packages/core/src/__tests__/registries/station-data-packs.test.ts`
- **Edit (core):**
  - `packages/core/src/registries/index.ts`
  - `packages/core/src/content/station-attachments.util.ts`
  - `packages/core/src/__tests__/content/station-attachments.util.test.ts`
- **Delete (api):**
  - `apps/api/src/utils/station-data-packs.util.ts`
  - `apps/api/src/__tests__/utils/station-data-packs.util.test.ts`
- **Edit (api):** `apps/api/src/prompts/system.prompt.ts`, `apps/api/src/tools/platform-help.tool.ts` (imports only).
- **Edit (web):**
  - `utils/tool-packs.util.ts`
  - `utils/use-builtin-entitlements.util.ts`
  - `components/StationAttachmentAlerts.component.tsx`
  - `components/PortalHeaderMeta.component.tsx`
  - `views/StationDetail.view.tsx`
  - their tests
  - `stories/StationAttachmentAlerts.component.stories.tsx` (a plan-excluded story)

## Next step

`docs/PLAN_EXCLUDED_PACKS_NOTICE.plan.md` sequences this in three commits on this branch:
1. move the classification to core, with the API importing it and its output unchanged;
2. add the core plan sentence and its type test;
3. the web: the helper, the hook flag, the alert with its link, and both surfaces.
