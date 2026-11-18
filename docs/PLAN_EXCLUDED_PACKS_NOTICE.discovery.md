# Station notice when the plan excludes the packs that would read data — Discovery

**Issue:** [EnterpriseBT/portal-ai#1055](https://github.com/EnterpriseBT/portal-ai/issues/1055)

**Why this exists.** A station's page and its portal header show a notice when nothing is attached. The notice is worded only from attachment counts: "No views are attached to this station. Attach a view to query entity data here."

Since #1045 the assistant and `platform_help` know a third state. Sometimes the station *does* carry packs whose tools read its records (such as Data Query or GIS), but the org's plan excludes every one of them, usually after a downgrade. Attaching a view changes nothing there; the plan is the reason. So the page and the assistant disagree, and the page's advice is wrong.

This is the change that lets the web classify a station the same way the API does, and words the notice for the plan when the plan is the reason.

**Copy (from review):** packs are only ever built-in or custom, so the notice names the excluded packs rather than describing a kind of pack.

## The current shape

### The classification (API only today)

| Piece | Location | Note |
|---|---|---|
| `PACK_USES_STATION_DATA` | `apps/api/src/utils/station-data-packs.util.ts:17-29` | `Record<BuiltinToolpackSlug, boolean>`, exhaustive. A new pack must be classified to compile. |
| `StationDataSetup` | same file, `:40` | `"usable" \| "plan-excluded" \| "none"` |
| `stationDataSetup(packs)` | same file, `:48-61` | Inputs: `effective`, `unentitled` (built-in slugs), `hasUsableCustomPack`, `hasExcludedCustomPack` |
| `usesStationData` | same file, `:71-80` | Any custom pack counts as working on data |
| Its only import | same file, `:1-4` | `isBuiltinToolpackSlug` / `BuiltinToolpackSlug` from `@portalai/core/registries`. No db or services, so it can move to core. |
| Tests | `apps/api/src/__tests__/utils/station-data-packs.util.test.ts:14`, `:61` | #848 classification; #1045 states (`:71`, `:83`, `:92`) |

Two callers exist, and they build the custom-pack flags differently:

- **System prompt.** `apps/api/src/prompts/system.prompt.ts:926-944`:
  - It sets `hasUsableCustomPack` from resolved custom pack rows.
  - On `plan-excluded` it tells the agent not to suggest attaching views.
  - It drops the attachment `missing` sentence unless the state is `usable` (`:932`).
- **`platform_help`.** `apps/api/src/tools/platform-help.tool.ts:156-161`:
  - It sets `hasUsableCustomPack` from `customPacksEntitled && configuredCustomPackCount > 0`.
  - It sets `hasExcludedCustomPack` from the excluded custom pack names.

Both read through `EntitlementService.resolveStationPacks` / `resolveStationPackSplit` (`apps/api/src/services/entitlement.service.ts:154-251`).

### The notice text (core content)

`describeStationAttachmentGaps(counts)` (`packages/core/src/content/station-attachments.util.ts:44`) returns `{ missing, noAccess }`, worded only from attached and readable counts (`:49-67`). Its callers:
- the web alert (`apps/web/src/components/StationAttachmentAlerts.component.tsx:29`);
- the system prompt (`system.prompt.ts:914`);
- `platform_help` (`platform-help.tool.ts:177`).

`packages/core/src/content` has a hard rule: **no file there imports anything**, enforced by `__tests__/content/content-purity.test.ts`, because the marketing site builds from it.

### The web surfaces

- **`StationAttachmentAlertsUI`** (`StationAttachmentAlerts.component.tsx:25-39`) is a pure UI component with no container. Its props are `viewCount` and `connectorCount`, and it renders `missing` as an `info` outlined `Alert`.
- **Station page.** `views/StationDetail.view.tsx` already holds every input the classification needs:
  - `station.enabledToolpacks`, rendered as chips at `:247-260`;
  - `useBuiltinEntitlements()` at `:91-92`;
  - the counts it passes to the alert at `:295-298`.
- **Portal header.** `components/PortalHeaderMeta.component.tsx` holds the same inputs:
  - packs at `:113`, alert at `:202-205`;
  - its container (`:223-245`) reads `isEntitled` and the usage payload.
- **`useBuiltinEntitlements`** (`utils/use-builtin-entitlements.util.ts:35-54`):
  - It returns `{ entitledSlugs, isEntitled, isLoading }` from `usage().data.tier.entitlements.builtinToolpacks`.
  - It **fails open** while loading, so `plan-excluded` can't flash during a load.
  - It doesn't expose `customToolpacks`.
- **Custom packs.** A custom pack reaches the web as `org:<organizationToolpackId>` inside `enabledToolpacks` (`apps/api/src/routes/station.router.ts:479-483`).
  - The plan's `customToolpacks: boolean` is in the same usage payload (`packages/core/src/models/tier.model.ts:72`), and `views/Toolpacks.view.tsx:420-421` already reads it.
  - `isBuiltinPackEntitled` treats every `org:` ref as entitled (`utils/tool-packs.util.ts:61-71`).
- **The plans link.** `UpgradeLink` (`components/UpgradeLink.component.tsx:33-55`, label "View plans") goes to `/settings?tab=billing`. It's already shown to every caller:
  - the turn-limit notice;
  - the create and edit station dialogs' upgrade note (`ToolPackUpgradeNote.component.tsx:18-28`);
  - Settings.

  Without `billing.manage`, the billing tab shows plans read-only (`SubscriptionBilling.component.tsx:84-86`, `:143`).
- **Existing plan wording** (`utils/tool-packs.util.ts:93-97`): "Inactive on your plan", "Not included in your plan". The comment there says plan copy is role-agnostic and never names a tier.

## The design space

### Decision 1 — Where the classification lives in core

- **A. `@portalai/core/registries`.** A new `station-data-packs.ts` next to `builtin-toolpacks.ts`, which the table is keyed by. The type and both functions move as they are, and `apps/api` imports them. That's a clean cut with no re-export left behind.
- **B. `@portalai/core/content`.** Next to `describeStationAttachmentGaps`. Not possible: the file imports `@portalai/core/registries`, and content allows no imports.
- **C. `@portalai/core/utils`.** Possible, but the exhaustive table belongs with the catalog it must stay in step with.

| | A registries | B content | C utils |
|---|---|---|---|
| Allowed by core's rules | Yes | No (purity) | Yes |
| Next to what keeps it exhaustive | Yes | — | No |

**Lean: A.** The table must change whenever a built-in pack is added, and it fails to compile if it doesn't, so it belongs beside that catalog.

### Decision 2 — Where the web gets the state

- **A. Compute it in the web.** Use `stationDataSetup` from core with inputs the page already has: the built-in packs split by `isEntitled`, plus whether any `org:` ref exists and the plan's `customToolpacks` flag.
- **B. Add `dataSetup` to the station payload.** The API computes it once, in the same place the prompt does.

| | A web computes | B payload field |
|---|---|---|
| Contract change | None | Station GET/list response + OpenAPI |
| Agrees with the chips on the page | Yes, same entitlement source | Possibly not, if one refetches before the other |
| Agrees with the assistant | Same function, different inputs (below) | Exactly |
| Loading behaviour | Fails open to `usable` (today's text) | Arrives with the station |

**Lean: A.** The page already decides each chip's "Inactive on your plan" from the same entitlements. Deriving the notice from them keeps the chip and the notice from contradicting each other, with no contract change.

The one input difference is a dangling `org:` ref (a station row whose custom pack was deleted). The API skips it, while the web would count it as a custom pack. Open question 2 settles it.

### Decision 3 — How the notice words the plan state

- **A. `describeStationAttachmentGaps(counts, { dataSetup })`.** In `plan-excluded`, `missing` becomes one plan sentence in place of the attach sentences. The other states are unchanged. The alert adds an `UpgradeLink` after it.
- **B. A separate core function and a separate alert.** That's two sources for one notice, and both could show at once.

**Lean: A.** It keeps one notice and one wording source. Content can't import the `StationDataSetup` type, so the option repeats the three literals, and a type test in core holds them equal to the registry's type.

Proposed sentence (role-agnostic, names no tier, and names the packs rather than a category):

> "**GIS** isn't included in your plan, so attaching a view won't make data available on this station."

- **The named packs** are the station's plan-excluded built-in packs that `usesStationData` counts, by their display names. Two are joined with "and": "Data Query and GIS aren't included…". More than three read "Data Query, GIS and 2 more aren't included…".
- **An excluded custom pack** reads "Your organization's tool packs".
- **Content can't import the catalog,** so the caller passes the display names in: `{ dataSetup, excludedPackNames }`.

The sentence is followed by the existing "View plans" link. It's an `info` alert, as today.

## Tradeoff comparison

|  | D1: registries | D2: web computes | D3: one notice, `dataSetup` option |
|---|---|---|---|
| Packages touched | core, api (import) | web | core, web |
| Contract change | No | No | No (additive optional argument) |
| Spread to spec | Yes | Yes | Yes |

## Recommendation

1. **Move the classification.** `PACK_USES_STATION_DATA`, `StationDataSetup`, `stationDataSetup` and `usesStationData` move from `apps/api/src/utils/station-data-packs.util.ts` to `packages/core/src/registries/station-data-packs.ts`, exported from `@portalai/core/registries`.
   - The API's two callers import them from core, and the API file is deleted.
   - Its tests move to core.
2. **Add the plan wording.** `describeStationAttachmentGaps` takes an optional second argument; `dataSetup` is `"usable" | "plan-excluded" | "none"`.
   - The argument is `{ dataSetup?: …; excludedPackNames?: readonly string[] }`.
   - In `plan-excluded`, `missing` is the plan sentence above, naming those packs, whatever the counts.
   - Otherwise it's unchanged. `none` keeps today's sentence (#848).
   - A core type test asserts that the literal union equals `StationDataSetup`.
3. **Give the alert the state.** `StationAttachmentAlertsUI` takes `dataSetup` and, in `plan-excluded`, renders the plan sentence followed by `UpgradeLink`.
4. **Add a web helper.** `stationDataSetupFor(enabledToolpacks, isEntitled, customPacksEntitled)` in `utils/tool-packs.util.ts` returns `{ dataSetup, excludedPackNames }`. The names come from the built-in registry's display names. The station page and the portal header both use it.
5. **Expose the custom-pack flag.** `useBuiltinEntitlements` also returns `customPacksEntitled` (the plan's `customToolpacks`). It fails open to `true` while loading, like the built-in set.
6. **Keep the API callers' behaviour.** The prompt and `platform_help` keep their current inputs, and their tests pin the same output.

## Open questions

1. **Should the prompt and `platform_help` also call `describeStationAttachmentGaps` with `dataSetup`,** replacing the prompt's own "drop `missing` unless usable" (`system.prompt.ts:932`)? **Lean: no.** The prompt's plan-excluded guidance is phrased for the agent and already right. Changing it widens the diff and the risk for no user-visible gain. The web is the gap.
2. **A dangling `org:` ref.** The web can't tell a deleted custom pack from a live one, so it would count it. In a plan without custom packs, a station whose only pack that reads data is that dangling ref would read `plan-excluded` on the page ("Your organization's tool packs aren't included…") but `none` in the assistant. **Lean: accept.** It needs a deleted custom pack *and* a plan without custom packs *and* no other pack that reads data. #1063 is about how these refs render and is the natural place to resolve them.
3. **Should the "Inactive on your plan" chip also mark excluded custom packs?** `isBuiltinPackEntitled` treats `org:` refs as entitled. **Lean: out of scope.** That's #1063's question, and the notice doesn't depend on the chip.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because the state is derived on render from data already loaded. Its one correctness risk, agreeing with the chips, is handled by sharing their entitlement source.
- **Accuracy & auditability:** N/A because this is display copy, not a record.
- **Failure modes:** **Lean: fail open.** While the usage payload loads, or if it fails, the state is `usable`, which shows today's text. Never showing the plan message wrongly is the safer error, and the page already behaves this way for chips.
- **Scale & unbounded growth:** N/A. It's a pure function over one station's pack list.
- **Multi-tenancy:** N/A. Inputs are the caller's org's plan and station, as already loaded.
- **Contract stability:** **Lean: additive only.** One optional argument on a core content function, and no API response change. A later tier axis plugs into `stationDataSetup`'s inputs.
- **Data lifecycle:** N/A.

## What this doesn't decide

- How `org:` refs render on chips, and marking excluded custom packs inactive. That's #1063, and the dangling-ref edge is noted above.
- The `none` state's wording. #848 decided to keep it.
- The agent-facing prompt text. It's already correct since #1045 and unchanged here.

## Next step

`docs/PLAN_EXCLUDED_PACKS_NOTICE.spec.md` pins the core API (the moved module and the `dataSetup` option and its sentence) and the web props. Then `.plan.md` lands it in three slices:
1. the move to core with the API imports, behaviour unchanged;
2. the core `dataSetup` wording and its type test;
3. the web helper, the hook's custom flag, and the alert with its link on both surfaces.
