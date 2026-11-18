# Station notice for plan-excluded packs — Plan

**Implements #1055 test-first. The station classification moves to core, the notice text learns the plan-excluded state, and the web uses both on the station page and the portal header.**

Spec: `docs/PLAN_EXCLUDED_PACKS_NOTICE.spec.md`. Discovery: `docs/PLAN_EXCLUDED_PACKS_NOTICE.discovery.md`. Issue: #1055. It builds on #1045's `stationDataSetup` (PR #1054) and #848's notice wording.

There are 3 slices. Each has a green test suite and leaves the repo compiling. They land as **commits on `fix/1055-plan-excluded-packs-notice`**: one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice:
1. write the failing tests;
2. make the smallest change that turns them green;
3. run them;
4. run `npm run lint && npm run type-check` (and core's `npm run build`, whose NodeNext rules type-check misses) at the boundary;
5. move on to the next slice.

Sequencing rationale:
- **Slice 1** moves the module with no behaviour change, so everything after it imports from core. It's the only slice touching `apps/api`.
- **Slice 2** is pure core content. It depends only on slice 1's type, for the equality test.
- **Slice 3** wires the web, using both.

---

## Slice 1 — Move the classification to `@portalai/core/registries`

`PACK_USES_STATION_DATA`, `StationDataSetup`, `stationDataSetup` and `usesStationData` move verbatim to core. The API imports them from there. No output changes.

**Files**

- New: `packages/core/src/registries/station-data-packs.ts`, the body of `apps/api/src/utils/station-data-packs.util.ts`, importing `./builtin-toolpacks.js`.
- New: `packages/core/src/__tests__/registries/station-data-packs.test.ts`, the cases from `apps/api/src/__tests__/utils/station-data-packs.util.test.ts`.
- Edit: `packages/core/src/registries/index.ts`, adding `export * from "./station-data-packs.js";`.
- Edit: `apps/api/src/prompts/system.prompt.ts:23`, `apps/api/src/tools/platform-help.tool.ts:24`, importing from `@portalai/core/registries`.
- Delete: `apps/api/src/utils/station-data-packs.util.ts` and its test.

**Steps**

1. **Tests (spec: Core registries, ≈ 9 moved cases).** Add the core test file importing from `../../registries/station-data-packs.js`. Run it and confirm it fails (the module is missing).
2. **Implement.** Create the core module and export it. Rebuild core and read the build output. Switch the two API imports, then delete the API module and its test.
3. **Green.**
   - The core registries tests pass.
   - In `apps/api`, `system.prompt.test.ts` and `platform-help.tool.test.ts` pass unchanged, which proves the output didn't change.
   - Lint and type-check pass in core and api.

**Done when:**
- `grep -r station-data-packs.util apps/api/src` finds nothing.
- The moved cases pass in core.
- The API prompt and `platform_help` suites are green with no edits.

**Risk:** a stale core `dist` makes the API type-check fail. Rebuild core before the API checks (see memory: core build needs `.js` imports).

---

## Slice 2 — The plan sentence in `describeStationAttachmentGaps`

Add the optional `{ dataSetup, excludedPackNames }` argument and the plan sentence, plus `STATION_PLAN_EXCLUDED_CUSTOM_PACKS`. No caller passes the option yet.

**Files**

- Edit: `packages/core/src/content/station-attachments.util.ts`, adding `StationAttachmentGapsOptions`, the second parameter, the list joiner, the sentence and the constant. Still no imports.
- Edit: `packages/core/src/__tests__/content/station-attachments.util.test.ts`.
- Edit: `packages/core/src/__tests__/registries/station-data-packs.test.ts`, adding the type-equality case.

**Steps**

1. **Tests (spec: Core content, ≈ 10 cases, plus 1 type case):**
   - omitted, `usable` and `none` all equal today's output for each count combination;
   - `plan-excluded` with 0/0 and with both attached gives the plan sentence;
   - 1 name uses `isn't`; 2 names; 3 names; 5 names give `A, B, C and 2 more`;
   - an empty list gives the "Some tool packs on this station" fallback;
   - the custom constant first, and not first (lowercase);
   - `noAccess` is unchanged under `plan-excluded`;
   - the type equality with `StationDataSetup`.

   Run them and confirm they fail.
2. **Implement** the option and the sentence. Green.
3. **Checks:**
   - lint, type-check and core build pass;
   - `content-purity.test.ts` stays green (no import added);
   - the API suites still pass, since they call the function without the option.

**Done when:** the new content cases pass, purity holds, and nothing outside core changed.

**Risk:** none. The change is additive, and the default path is byte-identical.

---

## Slice 3 — The web: helper, hook flag, alert and both surfaces

The station page and the portal header compute the state and show the plan sentence with "View plans" when the plan excludes the packs.

**Files**

- Edit: `apps/web/src/utils/tool-packs.util.ts`, adding `stationDataSetupFor`.
- Edit: `apps/web/src/utils/use-builtin-entitlements.util.ts`, adding `customPacksEntitled` (fails open to `true`).
- Edit: `apps/web/src/components/StationAttachmentAlerts.component.tsx`, adding the `dataSetup` / `excludedPackNames` props and `UpgradeLink` in `plan-excluded`.
- Edit: `apps/web/src/views/StationDetail.view.tsx:295`, passing the helper's result.
- Edit: `apps/web/src/components/PortalHeaderMeta.component.tsx`:
  - the UI gets a `customPacksEntitled` prop and passes the helper's result to the alert;
  - the container passes the hook's flag.
- Edit tests:
  - `__tests__/ToolPackUtil.test.ts`
  - `__tests__/useBuiltinEntitlements.test.tsx`
  - `__tests__/StationAttachmentAlerts.test.tsx`
  - `__tests__/StationDetail.view.test.tsx`
  - `__tests__/PortalHeaderMeta.component.test.tsx`
- Edit: `apps/web/src/stories/StationAttachmentAlerts.component.stories.tsx`, adding a `PlanExcluded` story.

**Steps**

1. **Tests (spec: Web, ≈ 14 cases):**
   - **`stationDataSetupFor`** (6):
     - all entitled → `usable`;
     - GIS + Curated Views with GIS excluded → `plan-excluded` / `["GIS"]`;
     - Web Search only → `none`;
     - an excluded custom pack only → `plan-excluded` / `["Your organization's tool packs"]`;
     - an entitled custom pack → `usable`;
     - names follow the station's order.
   - **Hook** (2): `customPacksEntitled` follows the payload, and is `true` when the payload is absent.
   - **Alert** (4):
     - `plan-excluded` shows the sentence and a "View plans" link to `/settings?tab=billing`;
     - no "Attach a view" text;
     - other states are unchanged;
     - axe on the plan state.
   - **Surfaces** (2): `StationDetail` and `PortalHeaderMetaUI` with a GIS + Curated Views station on a plan without GIS show the plan sentence.

   Run them and confirm they fail.
2. **Implement** the helper, the hook flag, the alert props and the two call sites. Green.
3. **Checks:**
   - lint and type-check in web;
   - the web guard suites (`component-axe`, `permission-copy`, etc.) pass;
   - the full touched-file run is green.

**Done when:**
- the repro station shows the plan sentence and "View plans" on both surfaces, and no "Attach a view";
- every other state renders as before;
- while entitlements load, the notice is today's text.

**Risk:** `PortalHeaderMetaUI` has other tests that render it without the new prop. The prop defaults to `true`, so they keep passing.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Classification in core; API imports it | Moved cases green; API prompt and `platform_help` suites unchanged and green |
| 2 | `dataSetup` option and plan sentence in core content | Content cases and type equality green; purity holds |
| 3 | Web helper, hook flag, alert, station page, portal header | Web cases and guards green; repro shows the plan notice |

## Cross-slice notes

- **Core build.** Slices 1 and 2 change core. Run core's `npm run build` and read its output before running API or web checks. `dist` is what they import.
- **Doc sync.**
  - The behaviour the FAQ and glossary describe ("inactive" packs, Settings → Subscription & Billing) is unchanged, so there's no help-content edit.
  - Slice 3 adds a link inside an existing alert. Check `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`; no row should need to change (it's a standard link in an `info` alert).
- **Smoke.** `/smoke 1055` follows implementation, built from the spec's acceptance criteria. Reproducing needs an org on a plan without GIS (`portalai` tier change locally) and a GIS + Curated Views station.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
