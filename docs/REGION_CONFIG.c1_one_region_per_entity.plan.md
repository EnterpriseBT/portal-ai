# C1 — One Region per Entity — Implementation Plan

TDD-ordered walkthrough to ship
`REGION_CONFIG.c1_one_region_per_entity.spec.md` as a single PR. Every
step is **red → green → refactor**: write (or extend) the failing test
first, run it to confirm it fails for the right reason, implement the
smallest change that makes it green, run the scoped command, then
extend coverage and refactor.

Feature flag: none. Rule is universally correct.

## Pre-flight

Open the current state so later steps have accurate references:

- `packages/spreadsheet-parsing/src/interpret/stages/score-and-warn.ts`
  — note the existing warning emission pattern (`emitWarning(...)`).
- `packages/spreadsheet-parsing/src/plan/warnings.ts` (or wherever
  the warning-code union + severity map live) — note where new codes
  get registered.
- `apps/api/src/services/layout-plan-commit.service.ts` — note the
  early-validation section before the per-target loop at
  `bindingsByTarget`.
- `apps/api/src/constants/api-codes.constants.ts` — note the
  surrounding `LAYOUT_PLAN_*` codes.
- `apps/web/src/modules/RegionEditor/utils/region-editor-validation.util.ts`
  — note `validateRegion` and `validateRegions`.
- `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`
  — note the entity picker (`AsyncSearchableSelect`) + its
  `entityOptions` prop contract.
- `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`
  — note the current shape of `entityOptions` threading.

Commands referenced throughout, always run from `/workspace`:

| Purpose                     | Command                                                     |
|-----------------------------|-------------------------------------------------------------|
| Parser unit + integration   | `npm --workspace packages/spreadsheet-parsing run test`     |
| API unit                    | `npm --workspace apps/api run test:unit`                    |
| API integration             | `npm --workspace apps/api run test:integration`             |
| Web unit                    | `npm --workspace apps/web run test:unit`                    |
| Root type-check             | `npm run type-check`                                        |

Per the memory on test scripts, never run `npx jest` directly — these
scripts set the right `NODE_OPTIONS`.

---

## Phase A — Error codes (foundational; no tests, used by later phases)

### A1. Register parser warning code

**File**: `packages/spreadsheet-parsing/src/plan/warnings.ts`
(or the module that declares the `WarningCode` union + severity map).

Add `DUPLICATE_ENTITY_TARGET` to the union with severity `"blocker"`.
No standalone test; correctness is verified via the parser test in B1.

### A2. Register API error code

**File**: `apps/api/src/constants/api-codes.constants.ts`.

Add `LAYOUT_PLAN_DUPLICATE_ENTITY` to the `ApiCode` enum.

---

## Phase B — Parser (interpret pipeline)

### B1. Red — duplicate-target blocker test

**File**:
`packages/spreadsheet-parsing/src/interpret/stages/__tests__/score-and-warn.test.ts`.

Add three cases:

```ts
describe("scoreAndWarn — DUPLICATE_ENTITY_TARGET (C1)", () => {
  it("emits a blocker on the second region when two hints share a target", () => {
    // Input: two regions, both targetEntityDefinitionId "contacts",
    // on the same sheet, disjoint bounds. Interpret runs; expect a
    // warning with code DUPLICATE_ENTITY_TARGET on the second region.
  });

  it("emits the blocker when two same-target regions sit on different sheets", () => {
    // Sheet boundaries don't distinguish entities per C1's rule.
  });

  it("does not emit the blocker for regions with targetEntityDefinitionId === null", () => {
    // Null targets are allowed during drafting.
  });
});
```

Run: `npm --workspace packages/spreadsheet-parsing run test --
score-and-warn`. Expect failure — the warning doesn't exist yet.

### B2. Green — emit the blocker

**File**:
`packages/spreadsheet-parsing/src/interpret/stages/score-and-warn.ts`.

Inside the `scoreAndWarn` orchestration (either as its own pre-pass
or a first block of the per-region loop):

```ts
const seenTargets = new Map<string, string>(); // targetId → firstRegionId
for (const region of state.detectedRegions) {
  if (!region.targetEntityDefinitionId) continue;
  const prior = seenTargets.get(region.targetEntityDefinitionId);
  if (prior !== undefined && prior !== region.id) {
    emitWarning(region.warnings, "DUPLICATE_ENTITY_TARGET",
      `Two regions target the same entity "${region.targetEntityDefinitionId}" — each entity must be produced by at most one region.`);
  } else {
    seenTargets.set(region.targetEntityDefinitionId, region.id);
  }
}
```

Run B1 again — green. Then re-run the whole parser suite to confirm
nothing else regresses:

```
npm --workspace packages/spreadsheet-parsing run test
```

### B3. Refactor

- If the duplicate check complicates the per-region loop, extract a
  small helper `assertUniqueTargets(regions): Warning[]` in the same
  file. Keep the public surface unchanged.
- Confirm the warning severity resolves to `"blocker"` via the
  severity map registered in A1 (follow the existing pattern used
  for other blocker codes like `UNSUPPORTED_LAYOUT_SHAPE`).

---

## Phase C — API commit-time validation

### C1. Red — integration test

**File**:
`apps/api/src/__tests__/__integration__/routes/layout-plans.router.integration.test.ts`
(or the commit-specific integration test file already in use).

Add two cases:

```ts
describe("POST /api/layout-plans/commit — C1 duplicate-target guard", () => {
  it("returns 400 LAYOUT_PLAN_DUPLICATE_ENTITY when the plan has two regions with the same targetEntityDefinitionId", async () => {
    // Seed a parsed upload session. Build a commit body whose plan
    // carries two regions both targetEntityDefinitionId: "contacts".
    // POST. Expect 400 + code LAYOUT_PLAN_DUPLICATE_ENTITY.
    // Assert no rows written (no new connectorInstance, no entities,
    // no field_mappings).
  });

  it("succeeds when the plan has one region per distinct target", async () => {
    // Regression — baseline shape still passes.
  });
});
```

Run: `npm --workspace apps/api run test:integration -- layout-plans`.
Expect the first case to fail — no validation exists yet.

### C2. Green — validate before touching the DB

**File**: `apps/api/src/services/layout-plan-commit.service.ts`.

Before the region-grouping block (`bindingsByTarget`), add a pass:

```ts
const seen = new Set<string>();
for (const region of plan.regions) {
  if (!region.targetEntityDefinitionId) continue;
  if (seen.has(region.targetEntityDefinitionId)) {
    throw new ApiError(
      400,
      ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY,
      `Plan contains multiple regions targeting entity "${region.targetEntityDefinitionId}". Each entity must be produced by exactly one region.`
    );
  }
  seen.add(region.targetEntityDefinitionId);
}
```

Run C1 again — green. Then:

```
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
```

### C3. Refactor

- The `bindingsByTarget` grouping code below still works — under C1
  each group has exactly one region — but the comment header
  explaining the grouping should be updated from "regions sharing a
  target merge into one entity" to "one region per target; grouping
  is kept for downstream per-entity write coordination".
- No behavioral change to `reconcileFieldMappings`; regions that
  would have "merged" now simply never reach commit.

---

## Phase D — Frontend validation util

### D1. Red — duplicate detection test

**File**:
`apps/web/src/modules/RegionEditor/__tests__/region-editor-validation.util.test.ts`.

Add:

```ts
describe("validateRegions — C1 duplicate-target detection", () => {
  it("attaches targetEntityDefinitionId error on both regions when two share a target", () => {
    const a = makeRegion({ id: "r1", targetEntityDefinitionId: "contacts" });
    const b = makeRegion({ id: "r2", targetEntityDefinitionId: "contacts" });
    const errors = validateRegions([a, b]);
    expect(errors["r1"]?.targetEntityDefinitionId).toMatch(/already/i);
    expect(errors["r2"]?.targetEntityDefinitionId).toMatch(/already/i);
  });

  it("does not flag regions with targetEntityDefinitionId === null", () => {
    const a = makeRegion({ id: "r1", targetEntityDefinitionId: null });
    const b = makeRegion({ id: "r2", targetEntityDefinitionId: null });
    expect(validateRegions([a, b])).toEqual({});
  });

  it("flags only the duplicates when three regions exist and two share a target", () => {
    // a:contacts, b:deals, c:contacts → errors on a and c, not on b.
  });
});
```

Run: `npm --workspace apps/web run test:unit -- region-editor-validation`.
Expect failure.

### D2. Green — implement

**File**:
`apps/web/src/modules/RegionEditor/utils/region-editor-validation.util.ts`.

Extend `validateRegions` to run a cross-region pass after the
per-region one:

```ts
export function validateRegions(regions: RegionDraft[]): RegionEditorErrors {
  const all: RegionEditorErrors = {};
  for (const region of regions) {
    const errors = validateRegion(region);
    if (Object.keys(errors).length > 0) all[region.id] = errors;
  }
  // Cross-region: duplicate targetEntityDefinitionId (C1).
  const byTarget = new Map<string, string[]>();
  for (const r of regions) {
    if (!r.targetEntityDefinitionId) continue;
    const list = byTarget.get(r.targetEntityDefinitionId) ?? [];
    list.push(r.id);
    byTarget.set(r.targetEntityDefinitionId, list);
  }
  for (const [, ids] of byTarget) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const existing = all[id] ?? {};
      existing.targetEntityDefinitionId =
        "This entity is already bound to another region in this upload.";
      all[id] = existing;
    }
  }
  return all;
}
```

Run D1 — green. Then re-run the full RegionEditor suite:

```
npm --workspace apps/web run test:unit -- modules/RegionEditor
```

### D3. Refactor

- If the validation util already has helper types for collision
  detection (see binding-level `validateRegionBindings` normalized-key
  collision check), align the new pass's structure to match.

---

## Phase E — Frontend entity-picker disable

### E1. Red — panel test

**File**:
`apps/web/src/modules/RegionEditor/__tests__/RegionConfigurationPanel.test.tsx`.

Add:

```ts
describe("RegionConfigurationPanel — C1 entity picker", () => {
  it("disables options claimed by other regions", () => {
    // Render with region r1 currently editing (target = null), and
    // claimedEntityKeys = new Set(["contacts"]). Open the picker;
    // the "contacts" option is disabled.
  });

  it("keeps the currently-editing region's own target selectable", () => {
    // Render with region r1 currently editing (target = "deals"),
    // and claimedEntityKeys = new Set(["deals"]) (the set includes
    // the editing region's claim). The current selection is
    // rendered as selected, not disabled.
  });
});
```

Run: `npm --workspace apps/web run test:unit -- RegionConfigurationPanel`.
Expect failure — the panel doesn't accept `claimedEntityKeys` yet.

### E2. Green — plumb `claimedEntityKeys`

**File**:
`apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`.

- Extend `RegionConfigurationPanelUIProps` with
  `claimedEntityKeys?: Set<string>` (default empty).
- Compute the disabled-options set: `claimed \ {currentTarget}`.
- Pass per-option `disabled: claimedWithoutSelf.has(opt.value)` into
  the `AsyncSearchableSelect` option renderer (or filter the options
  list, depending on what the select supports — follow the pattern
  already used elsewhere in this codebase; if no pattern exists,
  augment `SelectOption` with `disabled?: boolean` at the core
  package level in a separate micro-PR and ship C1 after that lands).

Run E1 — green.

### E3. Red — container wiring test

**File**:
`apps/web/src/workflows/FileUploadConnector/__tests__/FileUploadConnectorWorkflow.test.tsx`
(or the closest container-level test file).

```ts
it("passes the set of already-claimed entity targets into RegionConfigurationPanel", () => {
  // Seed workflow state with two regions; the second is the one
  // being edited. Assert the panel receives claimedEntityKeys
  // containing only the *other* region's target.
});
```

Run — expect failure.

### E4. Green — container wires it up

**File**:
`apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`
(or its UI component if the prop lives there).

Compute:

```ts
const claimedEntityKeys = useMemo(() => {
  const out = new Set<string>();
  for (const r of workflow.regions) {
    if (r.targetEntityDefinitionId) out.add(r.targetEntityDefinitionId);
  }
  return out;
}, [workflow.regions]);
```

Pass it through the region-drawing / review wiring into the panel.
Run E3 — green.

### E5. Integration test — selecting a claimed entity blocks Interpret

**File**: same container test file.

```ts
it("blocks Interpret when two regions are bound to the same entity", () => {
  // Draw two regions, bind both to "contacts" (the second must be
  // bound via a rename since the picker blocks direct selection).
  // Try to click Interpret — it's disabled / the click is a no-op
  // because validateRegions now returns an error.
});
```

Run: `npm --workspace apps/web run test:unit -- FileUploadConnectorWorkflow`.

### E6. Refactor

- If `claimedEntityKeys` is useful in the Review step too (for any
  entity-collision surfacing there), extract the derivation into a
  small util `utils/claimed-entity-keys.util.ts`.

---

## Phase F — Documentation

### F1. Update the architecture spec

**File**: `docs/SPREADSHEET_PARSING.architecture.spec.md`.

Replace § "Region → entity merge model" with "Region → entity 1:1
mapping". Content sketch:

> **Regions map 1:1 to entities.** Each region's
> `targetEntityDefinitionId` names the one entity it produces;
> duplicate targets inside a connector instance are rejected at
> interpret time (`DUPLICATE_ENTITY_TARGET` blocker) and at commit
> time (`LAYOUT_PLAN_DUPLICATE_ENTITY`). Before the C1 change this
> doc documented a merge semantic; that no longer applies — see
> `docs/REGION_CONFIG.c1_one_region_per_entity.spec.md`.

### F2. Link the spec from the discovery

(`docs/REGION_CONFIG_FLEXIBILITY.discovery.md` already references
the specs table; no change needed.)

---

## Phase G — Full-suite verification

Run, in order:

```
npm run type-check
npm --workspace packages/spreadsheet-parsing run test
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
npm --workspace apps/web run test:unit
```

All should be green. If any suite turned up a regression that isn't
C1-specific (e.g. an existing test that assumed region-merge
semantics), treat it as a migration task: update the test to reflect
1:1 semantics, note the update in the PR body.

## Phase H — Manual smoke test

Optional but recommended before merging:

1. `npm run dev`. Open the upload connector.
2. Upload any two-sheet fixture.
3. Draw two regions. Bind both to the same entity — confirm the
   second picker shows the entity greyed out / disabled.
4. Rename one region's target to match the other's via direct edit
   — confirm the review step surfaces the error chip on both
   regions and Interpret stays disabled.
5. Rename back to distinct targets — Interpret re-enables.

## Commit / PR checklist

- [ ] A1 warning code registered (parser)
- [ ] A2 API code registered
- [ ] B1–B3 parser test + implementation
- [ ] C1–C3 API integration test + commit-service validation
- [ ] D1–D3 frontend validation-util test + impl
- [ ] E1–E6 panel + container picker wiring + tests
- [ ] F1 architecture-spec rewrite
- [ ] Full suite green
- [ ] Manual smoke done
- [ ] PR description notes: "Implements
  `REGION_CONFIG.c1_one_region_per_entity.spec.md`. Rejects duplicate
  `targetEntityDefinitionId` at parser, API, and editor layers. No
  schema change, no feature flag."
