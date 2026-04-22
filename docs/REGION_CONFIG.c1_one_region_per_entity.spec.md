# C1 — One Region per Entity (per Connector Instance)

Scope for a single PR. Rationale and acceptance-level thinking live in
`docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Simplifying
constraints → C1".

## Rule

Within a single `connector_instance`, every region has a unique
`targetEntityDefinitionId`. Two regions in the same instance may not
point at the same entity.

Cross-connector reuse of an entity is not a thing — each connector has
its own entity set. See `c2` spec for the org-wide key-uniqueness that
makes cross-connector *references* unambiguous.

## Out of scope

- Regions with `targetEntityDefinitionId === null` still allowed
  (pre-entity-binding state during region drawing); the check only
  applies once a target is set.
- Cross-sheet duplicate targets within one connector are still
  prohibited under this rule — sheet boundaries do not distinguish
  entities.

## Schema

No schema change. This is purely a validation rule at three layers.

## Code changes

### Parser — `packages/spreadsheet-parsing/`

**`src/interpret/stages/score-and-warn.ts`** — add a check that fires
once per region set:

```ts
// Pseudocode inside scoreAndWarn's per-region loop or as a pre-pass
const seenTargets = new Map<string, string>(); // targetId → regionId
for (const region of state.detectedRegions) {
  if (!region.targetEntityDefinitionId) continue;
  const prior = seenTargets.get(region.targetEntityDefinitionId);
  if (prior !== undefined && prior !== region.id) {
    emitWarning(region.warnings, "DUPLICATE_ENTITY_TARGET", /* ... */);
  } else {
    seenTargets.set(region.targetEntityDefinitionId, region.id);
  }
}
```

- New warning code: `DUPLICATE_ENTITY_TARGET`, severity `blocker`.
- Registered in `packages/spreadsheet-parsing/src/plan/warnings.ts`
  alongside the existing codes.

### API — `apps/api/`

**`src/services/layout-plan-commit.service.ts`** — reject the commit
payload up-front if the plan's regions contain duplicate targets.
Throws `ApiError(400, ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY, ...)`
before any DB work.

**`src/constants/api-codes.constants.ts`** — add
`LAYOUT_PLAN_DUPLICATE_ENTITY` to the `ApiCode` enum.

**Code simplification**: `bindingsByTarget` in
`layout-plan-commit.service.ts` currently collects bindings per
target in case multiple regions share one. Under C1 each group has
exactly one region. The code keeps working unchanged but comments get
updated to reflect one-region-one-entity.

### Frontend — `apps/web/`

**`src/modules/RegionEditor/utils/region-editor-validation.util.ts`** —
extend `validateRegions` to detect duplicate `targetEntityDefinitionId`
across regions. Duplicates attach an error string to both offending
regions, keyed `targetEntityDefinitionId`.

**`src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`** —
the entity picker (`AsyncSearchableSelect` + "Create new entity"
affordance) marks already-claimed target ids as disabled. Exact
mechanic: the container passes a `claimedEntityKeys: Set<string>` prop
derived from `regions`, and the picker filters or disables options
whose value is in the set (excluding the currently-editing region's
own selection so re-selecting your current target is a no-op).

Wiring point: `FileUploadConnectorWorkflow.component.tsx` already
passes `regions` into the panel via `entityOptions` — extending the
flow to also pass `claimedEntityKeys` is a one-line change.

### Docs

**`docs/SPREADSHEET_PARSING.architecture.spec.md`** § "Region → entity
merge model" — rewrite. The current text says regions sharing a key
merge into one entity. Under C1 that stops being true; the section
becomes "Region → entity 1:1 mapping" with a migration note.

## Acceptance criteria

- Parser: interpret of hints with two same-target regions produces a
  plan whose second region carries a `DUPLICATE_ENTITY_TARGET`
  blocker warning. Commit is blocked upstream by the warning-severity
  gate in `LayoutPlanCommitService.assertDriftAllowsCommit` (or the
  equivalent warning gate).
- API: commit endpoint returns 400 `LAYOUT_PLAN_DUPLICATE_ENTITY` when
  regions in the payload have duplicate targets, even if the parser
  warning was bypassed.
- Frontend: the region-editor's entity picker shows already-bound
  entities as disabled options. Selecting a duplicate via rename is
  rejected by `validateRegions`, which surfaces a per-region error
  chip in the review step.

## Test plan

### Parser (`packages/spreadsheet-parsing/src/interpret/stages/__tests__/score-and-warn.test.ts`)

- Two regions same target → second region carries blocker
  `DUPLICATE_ENTITY_TARGET`.
- Two regions on different sheets same target → blocker still fires
  (sheet boundaries don't distinguish entities).
- Regions with `targetEntityDefinitionId === null` → no blocker
  (null targets are allowed during drafting).

### API (`apps/api/src/__tests__/__integration__/routes/layout-plans.router.integration.test.ts`)

- POST commit with two regions both `targetEntityDefinitionId:
  "contacts"` → 400 `LAYOUT_PLAN_DUPLICATE_ENTITY`; no rows written.
- POST commit with one region each for "contacts" and "deals" →
  succeeds.

### Frontend

- `region-editor-validation.util.test.ts` — `validateRegions` returns
  an error keyed `targetEntityDefinitionId` on both regions when two
  share a target.
- `RegionConfigurationPanel.test.tsx` — when `claimedEntityKeys`
  contains the region's own target, picker still shows it selected;
  when it contains *another* region's target, that option is
  disabled.
- `FileUploadConnectorWorkflow.test.tsx` — drawing two regions and
  binding them to the same entity triggers the error UI and disables
  Interpret.

## Non-regression

- Single-region-per-entity plans continue to behave identically — no
  behavior change for any existing plan.
- Plans with `targetEntityDefinitionId: null` during editing continue
  to pass validation until the user sets a target.

## Rollout

One PR covering parser + API + frontend + docs. No feature flag —
the rule is universally correct for the new model and any plan that
would violate it was already broken at the merge layer.
