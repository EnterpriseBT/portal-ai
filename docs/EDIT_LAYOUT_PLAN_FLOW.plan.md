# Edit Layout Plan Flow — Plan

**TDD-sequenced implementation of the feature in `docs/EDIT_LAYOUT_PLAN_FLOW.spec.md`. Six slices, each behind a green test suite, each landing as one commit. The slicing is shaped so a partial merge is always shippable — slice 1 already gives the backend everything the edit view needs even though no UI exists yet, and slice 5 (the detail-view entry point) is the only one that makes the feature user-visible.**

Spec: `docs/EDIT_LAYOUT_PLAN_FLOW.spec.md`.

Run tests with:

```bash
# api gates
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration

# web gates
cd apps/web && npm test

# repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice loop:

1. Write failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. Lint + type-check at slice boundary.
5. Commit.

---

## Slice 1 — backend `getEditContext` + GET route

**Why first.** Every subsequent slice consumes the endpoint. Landing it (and its tests) first means the SDK + view work happens against a real backend, not a mock.

**Files**

- New: `apps/api/src/services/connector-instance-layout-plans.service.ts` — add `getEditContext(connectorInstanceId, organizationId)` method.
- Edit: `apps/api/src/routes/connector-instance-layout-plans.router.ts` — wire `GET /:connectorInstanceId/layout-plan/edit-context`.
- New: `packages/core/src/contracts/connector-instance-layout-plans.contract.ts` — add `LayoutPlanEditContextResponsePayloadSchema` + the matching TS type.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — verify `LAYOUT_PLAN_NOT_FOUND` is present (it is); no new codes unless `editable: false`'s `reason.code` warrants one (use `SOURCE_REMOVED` — internal-only string, doesn't need to be a top-level `ApiCode`).
- Edit: `apps/api/src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts` — cases 1–6 from the spec.

**Steps**

1. **Define the contract.** Add `LayoutPlanEditContextResponsePayloadSchema` next to the existing layout-plan contracts; the schema reuses `LayoutPlanSchema`, `WorkbookPreviewSchema`, and a small inline `editable: boolean + reason?: { code, message }` shape.

2. **Write the integration tests (cases 1–6).** Each test seeds an org + connector definition + instance + plan row + workbook source (upload session or cloud-spreadsheet fixture mock), GETs the new endpoint, and asserts on the bundled response.
   - Case 1: google-sheets path. Mock `GoogleSheetsConnectorService.resolveWorkbook` to return a fixed `WorkbookData`; assert the response carries `slug: "google-sheets"`, the plan, the planId, and a preview that matches the mocked workbook adapted via `toWorkbookPreview`.
   - Case 2: microsoft-excel path. Same shape; different mock.
   - Case 3: file-upload, source available. Seed an upload session + `parsed`-status `file_uploads` rows; assert `editable: true`, preview matches.
   - Case 4: file-upload, source removed. Seed an upload session whose `file_uploads` rows are gone (or all `committed` with the S3 sweep having run); assert `editable: false`, `reason.code === "SOURCE_REMOVED"`, no preview.
   - Case 5: plan missing. Instance exists, no plan row; assert 404 `LAYOUT_PLAN_NOT_FOUND`.
   - Case 6: cross-org. Caller in org A, instance in org B; assert 404 `CONNECTOR_INSTANCE_NOT_FOUND` (`ensureInstanceInOrg` already enforces this).

3. **Implement `getEditContext`.**
   - Call `ensureInstanceInOrg`.
   - `findCurrentByConnectorInstanceId` → `plan` + `planId` (or throw `LAYOUT_PLAN_NOT_FOUND`).
   - Load connector definition for `slug`.
   - Build the workbookSource discriminator the same way `prepareDraftCommit` does (uploadSession ID for `file-upload`, instance ID for cloud connectors). For file-upload, find the upload session by joining through the existing data (best path: look up the most recent `file_uploads` row tied to this instance via the prior commit's metadata — this needs a `findByConnectorInstanceId` lookup that returns the most recent uploadSessionId). If no upload-session is recoverable, set `editable: false` with `reason.code === "SOURCE_REMOVED"` and skip the preview build.
   - Call `LayoutPlanDraftService.resolveWorkbookBySource(workbookSource, organizationId)` to get `WorkbookData`.
   - Adapt to `WorkbookPreview` via the existing `toWorkbookPreview` helper (the parse path already exposes it; reuse).
   - Return the bundled payload.

4. **Wire the route.** Body of the route handler is one call into the service; the route adds the standard `getApplicationMetadata` middleware + the error envelope. No request validation needed (path param only).

5. **Run cases 1–6.** Green.

6. **Lint + type-check.** Clean.

**Done when:** the new endpoint returns the bundled payload for both cloud and file-upload sources, the `editable` flag flips correctly on the "source removed" branch, and all 6 integration cases pass.

**Risk:** the file-upload "find the upload session for this instance" lookup is the tricky part — the schema doesn't carry `connectorInstanceId` on `file_uploads` today. Two options: (a) walk the most recent `layout_plan_commit` job for this instance whose `metadata.workbookSource.kind === "uploadSession"` and read the `uploadSessionId` off it (works for any prior commit; no schema change); (b) add a column to `file_uploads` linking back to the instance (schema change; cleaner but a bigger lift). **Take option (a) for slice 1.** It's a one-query lookup against the `jobs` table; the integration tests cover both the "found" and "not found" branches.

---

## Slice 2 — frontend SDK + query keys

**Why now.** The view slice (3) imports these. Landing them first lets that slice's tests focus on the view behaviour, not on the SDK plumbing.

**Files**

- New: `apps/web/src/api/connector-instance-layout-plans.api.ts` — `getEditContext` (useAuthQuery), `patch` + `recommit` (useAuthMutation).
- Edit: `apps/web/src/api/keys.ts` — add `connectorInstanceLayoutPlans.root` + `connectorInstanceLayoutPlans.editContext(id)`.
- Edit: `apps/web/src/api/sdk.ts` — re-export `connectorInstanceLayoutPlans` on the `sdk` namespace.
- New: `apps/web/src/__tests__/api/connector-instance-layout-plans.api.test.ts` — cases 7–9 from the spec.

**Steps**

1. **Add the query keys.** `connectorInstanceLayoutPlans.root` + the `editContext(id)` factory. Match the existing `apps/web/src/api/keys.ts` patterns.

2. **Write the SDK tests (cases 7–9).**
   - Case 7: `getEditContext("inst-1")`'s query uses `GET /api/connector-instances/inst-1/layout-plan/edit-context` and returns the payload unwrapped.
   - Case 8: `patch({ connectorInstanceId, planId, body })` fires `PATCH /api/connector-instances/.../layout-plan/...`; on success, `queryClient.invalidateQueries({ queryKey: connectorInstanceLayoutPlans.root })` is called.
   - Case 9: `recommit({ connectorInstanceId, planId })` fires `POST /api/connector-instances/.../layout-plan/.../commit`; returns the `{ jobId, status }` envelope; on success invalidates `connectorInstances.root` (so the detail view re-fetches the running-job state).
   Each test uses the existing `apps/web/src/__tests__/test-utils.tsx` render util that wires `queryClient` + a mock `useAuthFetch`.

3. **Implement the SDK.** Three exports, each a thin wrapper around `useAuthQuery` / `useAuthMutation`. Pattern is identical to `apps/web/src/api/file-uploads.api.ts`. Slot into `sdk.connectorInstanceLayoutPlans`.

4. **Run cases 7–9.** Green.

5. **Lint + type-check.** Clean.

**Done when:** the SDK is callable from `sdk.connectorInstanceLayoutPlans.{getEditContext, patch, recommit}` with the right URLs + cache invalidation; tests pass.

**Risk:** the existing SDK pattern (`useAuthQuery` / `useAuthMutation`) is already exercised by every other API file in `apps/web/src/api`; there's no real risk here. The only nuance is making sure the `patch` body shape matches what `ConnectorInstanceLayoutPlansService.patch` accepts (`Partial<LayoutPlan>`-ish).

---

## Slice 3 — `EditLayoutPlanView` (container + UI, no entry point)

**Why now.** The detail-view button (slice 5) needs the route to exist; the route registration (slice 4) needs the view component to exist. Landing the view body first lets slices 4 and 5 import it directly.

**Files**

- New: `apps/web/src/views/EditLayoutPlan.view.tsx` — `EditLayoutPlanView` (container) + `EditLayoutPlanViewUI` (pure).
- New: `apps/web/src/views/utils/edit-layout-plan-slice-dispatcher.util.ts` — dispatch `loadSlice` by connector slug.
- New: `apps/web/src/__tests__/views/EditLayoutPlan.view.test.tsx` — cases 10–14 from the spec.

**Steps**

1. **Write the view tests (cases 10–14).** Each test renders `<EditLayoutPlanView connectorInstanceId="inst-1" />` with a mocked `sdk` and asserts on the rendered output / fired mutations.
   - Case 10: mount renders `RegionEditorUI` with regions derived from `plan.regions` (use `planRegionsToDrafts`) and `workbook` from `workbookPreview`.
   - Case 11: Save click fires PATCH with the current regions translated back through `regionDraftsToHints` + the rest of the plan envelope.
   - Case 12: Commit click fires recommit, then calls `navigate({ to: "/connectors/$connectorInstanceId" })`.
   - Case 13: `editable: false` → renders an info `<Alert>` + a link to `/connectors/new/file-upload`, no `RegionEditorUI`.
   - Case 14: recommit returns 409 with `LAYOUT_PLAN_BLOCKER_WARNINGS` → renders the inline `<Alert>`, the editor stays mounted, the Commit button is re-enabled.

2. **Implement the slice dispatcher.** A small function that takes `(slug, getEditContext payload)` and returns a `LoadSliceFn` bound to the matching SDK call:
   ```ts
   if (slug === "google-sheets") return sdk.googleSheets.sheetSlice() ...
   if (slug === "microsoft-excel") return sdk.microsoftExcel.sheetSlice() ...
   return sdk.fileUploads.sheetSlice() ...
   ```
   Closes over `connectorInstanceId` (or `uploadSessionId` for file-upload) so the editor call sites stay generic.

3. **Implement `EditLayoutPlanViewUI` (pure).**
   - Top bar: Cancel / Save draft / Commit buttons.
   - Body: `RegionEditorUI` (when `editable`) or the "source removed" notice.
   - Inline `<FormAlert>` for `serverError`.

4. **Implement `EditLayoutPlanView` (container).**
   - `useAuthQuery` for the edit-context.
   - Local state for the working regions; mutate via the standard editor callbacks.
   - Hooks for `patch.mutateAsync` and `recommit.mutateAsync`.
   - Loading / error / not-found render branches that match the existing app conventions.

5. **Run cases 10–14.** Green.

6. **Lint + type-check.** Clean.

**Done when:** the view renders, fetches, mutates, and navigates against a mocked SDK; all 5 view tests pass.

**Risk:** `planRegionsToDrafts` + `regionDraftsToHints` are already in `apps/web/src/modules/RegionEditor/utils/`. They're tested. Reusing them here is the natural path; the only thing to watch is that the `workbook` shape we hand to `regionDraftsToHints` matches what the new-connector workflows use (it's the same `Workbook` interface from `@portalai/spreadsheet-parsing`).

---

## Slice 4 — TanStack route + 404 page

**Files**

- New: `apps/web/src/routes/_authorized/connectors.$connectorInstanceId.layout-plan.edit.tsx` — `createFileRoute` registering `/connectors/$connectorInstanceId/layout-plan/edit`.
- Regenerated: `apps/web/src/routeTree.gen.ts` (auto-updates on save in dev; commit alongside).
- New: `apps/web/src/__tests__/routes/connectors.layout-plan.edit.test.tsx` — sanity test: navigating to the route mounts `<EditLayoutPlanView>`.

**Steps**

1. **Define the route.** `createFileRoute("/_authorized/connectors/$connectorInstanceId/layout-plan/edit")` with a component that pulls `params.connectorInstanceId` and renders `<EditLayoutPlanView connectorInstanceId={...} />`. No loaders — the view's query handles its own fetch.

2. **Regenerate the route tree.** `npm run dev` in `apps/web` triggers TanStack's file-based router to update `routeTree.gen.ts`. Commit it.

3. **Write the route test.** Navigates to the path via the test router and asserts that `<EditLayoutPlanView>` mounts with the right `connectorInstanceId` prop.

4. **Run tests.** Green.

5. **Lint + type-check.** Clean.

**Done when:** `/connectors/:id/layout-plan/edit` is a real route that renders the view.

**Risk:** none beyond the standard TanStack route-tree regeneration. If the test runs before `routeTree.gen.ts` updates, the test fails loudly with a clear message.

---

## Slice 5 — entry point on `ConnectorInstance.view.tsx`

**Files**

- Edit: `apps/web/src/views/ConnectorInstance.view.tsx` — add the "Edit layout plan" button.
- Edit: `apps/web/src/__tests__/views/ConnectorInstance.view.test.tsx` — cases 15–17 from the spec.

**Steps**

1. **Write the entry-point tests (cases 15–17).**
   - Case 15: connector with slug `google-sheets`, no running jobs → button renders, clicking it navigates to `/connectors/$connectorInstanceId/layout-plan/edit`.
   - Case 16: running `layout_plan_commit` job → button rendered but `disabled`, tooltip mentions the running job.
   - Case 17: slug doesn't support edit (e.g., a hypothetical sandbox slug from the test fixture) → button hidden or disabled with a "not supported" tooltip; doesn't navigate on click.

2. **Implement the button.** Sits next to the existing Sync button. Its disabled state mirrors Sync's (same `runningJobs` query). Visibility predicate matches the backend's `editable` rule (`slug ∈ {"google-sheets", "microsoft-excel", "file-upload"}` — for file-upload the actual route then handles the "source removed" branch).

3. **Run cases 15–17.** Green.

4. **Lint + type-check.** Clean.

**Done when:** the detail view exposes the entry point; the lock-state gate works.

**Risk:** the test pulls in the full detail view, which already has SSE / running-jobs mocks. Reuse those — don't rewrite the setup.

---

## Slice 6 — manual smoke + acceptance criteria

**No new files.** Run through every checkbox in the spec's "Acceptance criteria" section against a local dev environment:

```bash
npm run dev
```

- [ ] Complete a Google Sheets connector commit.
- [ ] Navigate to detail view → click "Edit layout plan" → land on `/connectors/:id/layout-plan/edit`.
- [ ] Change a column binding → Save → toast renders → reload route → binding persisted.
- [ ] Click Commit → land on detail view → running-job alert renders → SSE terminal event clears it → records reflect the new binding.
- [ ] File-upload connector committed weeks ago (or simulate by deleting the `file_uploads` rows) → Edit button disabled with tooltip → direct navigation renders the "Source removed" notice.
- [ ] All 17 cases pass; whole-repo lint + type-check + tests green.

If a smoke check fails, file the bug back into a follow-up slice; don't ship around it.

---

## Cross-slice gates

After every slice:

1. `cd apps/api && npm run test:unit && npm run test:integration` is green (api slices touch backend tests; web slices stay green here too since the api surface is purely additive).
2. `cd apps/web && npm test` is green (web slices add tests; api slices add a new endpoint that's only consumed by the web suite after slice 2).
3. `npm run lint && npm run type-check` from repo root are clean.
4. `git diff --stat` matches the slice's "Files" list.

---

## What this plan does *not* attempt

- **Plan revision history / supersede surface.** PATCH edits the same row; a "view prior revisions" UI is a separate feature.
- **Re-run interpret from the edit view.** Opens the door to AI-driven plan suggestions for an existing connector; bolt-on after this feature lands.
- **File-upload re-upload from inside the edit view.** When `editable: false`, the user is sent to the new-connector wizard; replacing a connector's source workbook in-place is a separate workflow.
- **Schema changes to `file_uploads` / `connector_instances`.** Slice 1 takes the no-schema-change path (walk prior jobs). A schema migration is the easier-to-reason-about option but out of scope for v1.
- **Bumping S3 retention so file-upload always stays editable.** Retention policy is a deploy-time tradeoff; not this PR's call.
