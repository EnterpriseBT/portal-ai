# Custom Toolpack Registration — Phase 4 — Plan

**TDD-sequenced implementation of the station-dialog collision warning.**

Spec: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_4.spec.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`. Phase 3: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_3.{spec,plan}.md`.

Phase 4 is small enough to be a single PR with two slices. Schema refresh stays manual — phase 2's `EditToolpackDialog` "Refresh schema" button is the user-driven sync, no automation added.

Run tests with the project's npm scripts (per `feedback_use_npm_test_scripts`):

```bash
cd apps/web && npm run test:unit
```

---

## Slice 1 — Collision detection helper (pure)

Pure function. No DOM, no SDK, no React state.

**Files**

- New: `apps/web/src/utils/toolpack-collisions.util.ts`
- New: `apps/web/src/__tests__/toolpack-collisions.util.test.ts`

**Steps**

1. **Write the failing tests (cases 120–123).** Build small `Toolpack[]` fixtures (built-in + custom shapes) inline in the test file. Each case isolates one branch:

   - 120: `["data_query", "statistics"]` → `[]`. Built-ins are guaranteed non-colliding by the registry's globally-unique tool-name invariant.
   - 121: two custom packs (`{id:"otp-a", tools:[lookup_company]}`, `{id:"otp-b", tools:[lookup_company]}`); refs `["org:otp-a", "org:otp-b"]` → one collision entry with `ownerLabels` sorted alphabetically.
   - 122: a custom pack defining `sql_query` (would never pass phase-2 registration, but the helper is defensive); selection `["data_query", "org:otp-c"]` → one collision naming both built-in pack and the custom pack's display name.
   - 123: ref `org:does-not-exist` not in customs payload; selection `["org:does-not-exist", "data_query"]` → `[]`. Helper skips silently.

2. **Author the helper.** Per the spec — single exported `detectToolpackCollisions(selectedRefs, customs)` plus a private `resolve(ref, customs)` helper.

3. **Run the focused suite.** `cd apps/web && npm run test:unit -- toolpack-collisions.util`. All four green.

4. **Lint + type-check.**

**Done when:** cases 120–123 pass.

**Risk:** built-in tool names are globally unique by `BUILTIN_TOOLPACKS` construction, so case 120 should never produce a collision. The test asserts that as a guarantee — defends against future drift in the registry. If the registry ever introduces a duplicate, this test is the alarm.

---

## Slice 2 — Dialog warnings on Create/EditStationDialog

Wire the helper into both station dialogs.

**Files**

- Edit: `apps/web/src/components/CreateStationDialog.component.tsx` — render the `<Alert>` panel below the toolpacks picker.
- Edit: `apps/web/src/components/EditStationDialog.component.tsx` — same.
- Edit: `apps/web/src/__tests__/CreateStationDialog.test.tsx` — case 124.
- Edit: `apps/web/src/__tests__/EditStationDialog.test.tsx` — case 125.

**Steps**

1. **Write the failing tests (cases 124–125).** The existing test files already mock `sdk.toolpacks.list({ kind: "custom" })` (phase 2 slice 9). Extend the mock fixture for these cases to return two custom packs whose `tools` arrays both contain `lookup_company`:

   ```ts
   const COLLIDING_CUSTOMS: Toolpack[] = [
     buildCustom({
       id: "otp-a",
       name: "customer_intel",
       tools: [{ name: "lookup_company", description: "…", parameterSchema: {…} }],
     }),
     buildCustom({
       id: "otp-b",
       name: "sales_intel",
       tools: [{ name: "lookup_company", description: "…", parameterSchema: {…} }],
     }),
   ];
   ```

   The test then drives the `MultiSearchableSelect` (or Autocomplete on Create) to select both `org:otp-a` and `org:otp-b`. Asserts:

   - `getByTestId("toolpack-collision-warning")` is in the document.
   - The colliding tool name `lookup_company` appears in the alert text.
   - Both pack names (`customer_intel`, `sales_intel`) appear in the alert text.

   Then deselect one of the two and assert `queryByTestId("toolpack-collision-warning")` is null.

2. **Author the dialog edits.** Both files already have `customsResult` in scope from slice 9 of phase 2.

   Add the import:
   ```tsx
   import { detectToolpackCollisions } from "../utils/toolpack-collisions.util";
   import Alert from "@mui/material/Alert";
   import AlertTitle from "@mui/material/AlertTitle";
   ```

   Compute collisions:
   ```tsx
   const collisions = useMemo(
     () =>
       detectToolpackCollisions(
         form.toolPacks,
         (customsResult.data?.toolpacks ?? []) as Toolpack[]
       ),
     [form.toolPacks, customsResult.data]
   );
   ```

   Render the panel below the toolpacks picker (immediately after the Autocomplete / MultiSearchableSelect). The test selector is `data-testid="toolpack-collision-warning"`.

3. **Run focused tests.** Cases 124–125 green.

4. **Run the full web suite.** All 2100+ existing tests stay green; no regression expected — the panel is additive and conditionally rendered.

5. **Lint + type-check.**

6. **Manual smoke.** `npm run dev`; register two custom packs that both define a tool named `lookup_company`; open `EditStationDialog` and attach both; observe the warning. Remove one; warning disappears. Save with the warning showing; the station persists (P-4.1: save isn't blocked).

**Done when:** cases 124–125 pass; full web suite green; manual smoke confirms the warn-don't-block flow.

**Risk:** the `useMemo` dependency must include both `form.toolPacks` and `customsResult.data` — missing the customs would mean the warning doesn't update when the toolpacks list lazy-loads. The test should assert behavior across the data-lands moment if reasonable: render with empty data, then update data, then verify the warning appears. (For ergonomics, the test can drive both states by wrapping the mock factory in a re-renderable closure; if that's too brittle, a single render with the colliding payload up-front suffices and the lazy-load case is covered by the `useMemo` dependency list passing review.)

---

## Sequence summary

| Slice | What lands | Tests added | Test commands |
|---|---|---|---|
| 1 | Collision detection helper | 4 (120–123) | `cd apps/web && npm run test:unit -- toolpack-collisions.util` |
| 2 | Dialog warnings | 2 (124, 125) | `cd apps/web && npm run test:unit` |

Total **6 new test cases**, single PR, ~2 hours of work.

---

## Cross-slice notes

- **One PR.** No reason to split — both slices land together.

- **Zero new dependencies.** The helper imports `BUILTIN_TOOLPACK_BY_SLUG` and `isBuiltinToolpackSlug` from `@portalai/core/registries` (already in use). The dialog imports `Alert` and `AlertTitle` from `@mui/material` (already in the bundle).

- **No backend change.** Phase 4 is purely web-side. The runtime collision check in `tools.service.buildAnalyticsTools` (phase 2 slice 6) already exists and stays as the authoritative guard; phase 4 only mirrors its detection logic earlier in the flow.

- **Manual refresh stays manual.** No scheduler, no `toolpack_refresh` job type, no Drizzle migration, no boot wiring. The phase-2 EditToolpackDialog "Refresh schema" button remains the only refresh path; phase 4 doesn't touch it.

- **CLAUDE.md compliance.** New file follows the suffix convention (`*.util.ts`). Pure-helper utilities don't need a `*UI` split. The dialog edits leave the existing container/UI shape intact.

- **What we're not doing.** No alerting on collision (warning lives inline). No save-blocking. No "fix this for me" auto-resolver. No record-of-collision in the station row. Each could be a phase-5 polish item if real usage shows the need.
