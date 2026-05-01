# Phase B — Drop Sync Gate; Surface Identity Warnings

Removes the hard `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` block in the gsheets adapter so connector instances with `rowPosition` regions can sync. Replaces the `ok: false` outcome with an `ok: true, identityWarnings: [...]` advisory shape. Sync semantics already produce the correct reap-and-recreate behavior (`replay/identity.ts` + watermark reaper); this phase only flips the gate.

Depends on Phase A only conceptually — the type changes here don't read or write `IdentityStrategy.source`. Phase B can ship independently of A if the schedule favors it.

## B.1 Goals

1. `assertSyncEligibleIdentity` in `apps/api/src/services/sync-eligibility.util.ts` always returns `ok: true`; the previous `ineligibleRegionIds` is replaced by `identityWarnings: { regionId: string }[]`.
2. The gsheets adapter's `assertSyncEligibility` no longer returns `ok: false, reasonCode: LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` for `rowPosition` regions. It returns `ok: true` and forwards `identityWarnings` upward.
3. `SyncEligibility` (in `apps/api/src/adapters/adapter.interface.ts`) gains an optional `identityWarnings?: { regionId: string }[]` field.
4. The connector-instance serializer keeps `syncEligible: true` for plans that previously flipped it to `false` solely because of `rowPosition` regions.
5. End-to-end sync of a `rowPosition` plan completes successfully and shows a non-zero `created` + `deleted` delta after a row reorder.
6. `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` enum stays in `apps/api/src/constants/api-codes.constants.ts` (with a deprecation comment) so any external code referencing the string keeps building.

## B.2 Non-goals

- Frontend banner / button copy (Phase C).
- Identity selector UI (Phase D).
- Schema changes (Phase A).
- Repointing other adapters' eligibility helpers — this phase is gsheets-scoped because gsheets is the only adapter currently emitting the code.

## B.3 TDD plan — write these tests first, watch them fail, then implement

### B.3.1 Util-level: `assertSyncEligibleIdentity` shape change
File: `apps/api/src/__tests__/services/sync-eligibility.util.test.ts`

Existing tests (the ones that assert `{ ok: false, ineligibleRegionIds: [...] }` for a rowPosition plan) get rewritten — same fixtures, new assertion:

1. **Stable plan returns ok with no warnings.** A plan whose regions all use column/composite identity → `{ ok: true, identityWarnings: [] }`.
2. **rowPosition plan returns ok with warnings.** A plan with two rowPosition regions → `{ ok: true, identityWarnings: [{ regionId: "..." }, { regionId: "..." }] }`. Order matches the plan's `regions` order.
3. **Empty plan returns ok with no warnings.** Plan with `regions: []` → `{ ok: true, identityWarnings: [] }`.

### B.3.2 Adapter-level: gsheets
Files:
- `apps/api/src/__tests__/adapters/google-sheets-adapter.test.ts` (add)
- `apps/api/src/__tests__/__integration__/services/google-sheets-sync.integration.test.ts` (update)

1. **`assertSyncEligibility` returns ok for rowPosition.** Stub a current plan with one rowPosition region. Assert `{ ok: true, identityWarnings: [{ regionId }] }`. No `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` reasonCode emitted.
2. **`assertSyncEligibility` still returns ok: false for missing plan.** No current plan row → `{ ok: false, reasonCode: LAYOUT_PLAN_NOT_FOUND }`. Unchanged from current.
3. **Sync of a rowPosition plan completes.** Existing integration test asserting 409 flips to assert 2xx + non-empty `recordCounts.created`. Keep the row-reorder fixture; assert `created > 0` and `deleted > 0` after the second sync.

### B.3.3 Connector-instance serializer
File: `apps/api/src/__tests__/services/connector-instance-serializer.test.ts` (or wherever the redacted-instance shape is computed; verify path before editing)

1. **`syncEligible` stays true for rowPosition.** A connector instance whose current plan has a rowPosition region serializes with `syncEligible: true`.
2. **`syncEligible` stays false for missing plan.** Unchanged from current.

### B.3.4 Route-level
File: `apps/api/src/__tests__/__integration__/routes/connector-instance-sync.integration.test.ts` (find existing path; tests live near the sync route)

1. **POST sync returns 2xx for rowPosition.** A previously-blocked rowPosition plan fixture now syncs successfully through the route. The earlier 409 assertion is replaced.

## B.4 Implementation steps

### Step 1 — Refactor `sync-eligibility.util.ts`
File: `apps/api/src/services/sync-eligibility.util.ts`

Replace the existing exports:

```ts
export interface SyncEligibilityCheck {
  ok: true;
  identityWarnings: { regionId: string }[];
}

export function assertSyncEligibleIdentity(plan: LayoutPlan): SyncEligibilityCheck {
  const identityWarnings = plan.regions
    .filter((r) => r.identityStrategy?.kind === "rowPosition")
    .map((r) => ({ regionId: r.id }));
  return { ok: true, identityWarnings };
}
```

The old `SyncEligibility { ok, ineligibleRegionIds }` interface goes away — no other call site uses it directly outside the gsheets adapter and the test file.

Update the file's leading docblock to describe the new advisory semantics.

### Step 2 — Update gsheets `assertSyncEligibility`
File: `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts`

Drop the early-return on `eligibility.ok === false` for the rowPosition case. The new flow:

```ts
async function assertSyncEligibility(instance): Promise<SyncEligibility> {
  const planRow = await DbService.repository.connectorInstanceLayoutPlans
    .findCurrentByConnectorInstanceId(instance.id);
  if (!planRow) {
    return {
      ok: false,
      reasonCode: ApiCode.LAYOUT_PLAN_NOT_FOUND,
      reason: `No layout plan committed for instance ${instance.id} — commit the workflow before syncing`,
    };
  }
  const check = assertSyncEligibleIdentity(planRow.plan as LayoutPlan);
  return { ok: true, identityWarnings: check.identityWarnings };
}
```

The defensive re-check in `syncInstance` (lines ~105-113) only `throw`s when `!eligibility.ok`. With the new shape that branch only fires for the missing-plan case — leave the throw as-is.

### Step 3 — Extend `SyncEligibility` interface
File: `apps/api/src/adapters/adapter.interface.ts`

Add the optional field:

```ts
export interface SyncEligibility {
  ok: boolean;
  reasonCode?: string;
  reason?: string;
  details?: Record<string, unknown>;
  identityWarnings?: { regionId: string }[];
}
```

Update the JSDoc above the interface to mention identity warnings as an additive advisory channel.

### Step 4 — Connector-instance serializer
File: locate the serializer that computes `syncEligible` (search `syncEligible:` in `apps/api/src` excluding test files; it likely lives in a connector-instance redactor or service).

Today the field flips to `false` whenever `assertSyncEligibility` returned `ok: false`. With the new shape that only happens for `LAYOUT_PLAN_NOT_FOUND`. Confirm the serializer doesn't independently inspect the plan for `rowPosition` regions; if it does, remove that path. The serializer optionally surfaces `identityWarnings` on the instance shape so the UI can render the advisory tooltip without a second round-trip — wire it through if the contract supports it (Phase C reads the field).

### Step 5 — Mark API code as deprecated-but-present
File: `apps/api/src/constants/api-codes.constants.ts`

Above `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` add a one-line deprecation comment:

```ts
/** @deprecated as of <PR>; no current emitter — kept for backward-compat with consumers that match on the string. */
LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY = "LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY",
```

Do not delete the enum entry.

### Step 6 — Update the contract (optional for Phase B; mandatory for Phase C)
File: `packages/core/src/contracts/connector-instance.contract.ts`

If the connector-instance shape needs `identityWarnings?: z.array(...)` for Phase C, add it now under a feature flag or always-optional. Keep `syncEligible` semantics unchanged in copy of comments.

## B.5 Files touched

```
apps/api/src/services/sync-eligibility.util.ts
apps/api/src/adapters/google-sheets/google-sheets.adapter.ts
apps/api/src/adapters/adapter.interface.ts
apps/api/src/constants/api-codes.constants.ts
apps/api/src/__tests__/services/sync-eligibility.util.test.ts
apps/api/src/__tests__/__integration__/services/google-sheets-sync.integration.test.ts
apps/api/src/__tests__/__integration__/routes/connector-instance-sync.integration.test.ts (or equivalent path)
packages/core/src/contracts/connector-instance.contract.ts (optional; required by Phase C)
```

## B.6 Verification (acceptance for Phase B)

1. `npm run test:unit` and `npm run test:integration` clean in `apps/api`.
2. Manually trigger a sync against a connector instance whose committed plan has at least one rowPosition region. Assert:
   - HTTP 2xx response.
   - `recordCounts.created > 0` and `recordCounts.deleted > 0` after a row reorder in the source sheet.
   - Log line `gsheets.sync.completed` includes the run with the expected counts.
3. The instance's serialized shape (GET `/api/connector-instances/:id`) returns `syncEligible: true` for the same instance — confirms Step 4 wiring.
4. The frontend Sync button (still disabled in Phase B; lifted in Phase C) reflects `syncEligible: true` and is no longer blocked by the rowPosition reason — verify by inspection.

## B.7 Risks and mitigations

- **External clients matching on `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`.** The enum entry stays present; existing matches don't break. Once Phase B ships, the string is no longer emitted; matchers see no traffic. No action required from external consumers.
- **Sync churn surprise.** A rowPosition plan that was previously rejected now syncs and may produce dramatic delta counts on the first run. Phase C's banner softens the user-facing message; Phase B alone might land before that copy lands. Acceptable: the hard gate is the bigger problem.
- **Test fixtures pinned to the old shape.** Any test using `SyncEligibility { ok: false, reasonCode: LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY }` for the gsheets adapter needs an update. Grep for `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` and update assertions accordingly.
