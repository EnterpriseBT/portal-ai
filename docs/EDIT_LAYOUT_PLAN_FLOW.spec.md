# Edit Layout Plan Flow — Spec

**A new portal-app entry point that lets the user open an existing connector instance's region editor, mutate the committed `LayoutPlan`, and either save the draft or re-run the commit pipeline — without creating a new connector.**

Today the layout-plan surface is one-shot: the new-connector wizards (FileUploadConnector / GoogleSheetsConnector / MicrosoftExcelConnector) walk the user through upload → interpret → review → commit, and after commit the plan is frozen. There's no UI affordance for re-opening the region editor against an existing instance, no entry point for tweaking column bindings / identity strategy / region bounds, and no path to re-trigger the commit pipeline against an updated plan. Today's only recovery is "delete the connector and start over."

The backend already exposes everything we need — `GET /api/connector-instances/:id/layout-plan` (read), `PATCH /api/connector-instances/:id/layout-plan/:planId` (in-place plan edit, no records side-effect), and `POST /api/connector-instances/:id/layout-plan/:planId/commit` (recommit; re-runs the records-write pipeline). The work is purely frontend wiring + a thin server-side bundler.

---

## Scope

### In scope

1. **`GET /api/connector-instances/:id/layout-plan/edit-context`** — new server endpoint. Bundles the data the edit view needs at mount time into one round-trip:
   - `plan: LayoutPlan` — current plan (the `supersededBy IS NULL` row).
   - `planId: string` — for the PATCH + recommit calls.
   - `connectorDefinitionSlug: string` — the edit view dispatches by this to know which workflow-shaped UI to mount.
   - `workbookPreview: WorkbookPreview` — same envelope the `parse` / `interpret` paths return today. Sheets carry inline cells for small ones, `sliced: true` for big ones; the editor's existing `sheetSlice` SDK fills the rest.
   - `editable: boolean` + `reason?: string` — `false` when the connector's source can't be re-read (file-upload after S3 cleanup; see §"File-upload editability"). The frontend uses this to render a "re-upload to edit" affordance instead of the editor.

2. **SDK wrappers** under `sdk.connectorInstanceLayoutPlans`:
   - `getEditContext(connectorInstanceId)` — wraps the new GET.
   - `patch(connectorInstanceId, planId, plan)` — wraps the existing PATCH; uses `useAuthMutation` so cache invalidation hooks the layout-plan query key.
   - `recommit(connectorInstanceId, planId)` — wraps the existing recommit POST; returns the `{ jobId, status: "pending" }` 202 envelope the existing draft-commit path already returns.

3. **`/connectors/:id/layout-plan/edit` route + view** (TanStack Router, nested under `_authorized`):
   - Fetches edit-context via `useAuthQuery` keyed on `connectorInstanceId`.
   - Renders the existing `RegionEditorUI` (`apps/web/src/modules/RegionEditor/RegionEditor.component.tsx`) directly — no new workflow wrapper. The editor already takes `workbook` + `regions` + callbacks as props; we hand it the workbook from `workbookPreview`, the regions from `planRegionsToDrafts(plan, workbook)`, and a `loadSlice` dispatched by slug to the matching connector's existing `sheetSlice` SDK.
   - Two action buttons:
     - **Save draft** — fires PATCH. No records side-effect, so the user sees a toast `"Plan saved"` and stays on the page. Cache for the `layout-plan` query key invalidates so the next remount sees the new plan.
     - **Commit** — fires recommit. The route returns 202 with a `jobId`; we navigate to `/connectors/:id` (detail view) which already has the existing lock-state UI to watch the running `layout_plan_commit` job via SSE.
   - **Cancel** — `useNavigate` back to `/connectors/:id`.

4. **Entry point on the connector-instance detail view**:
   - `ConnectorInstance.view.tsx` gains an "Edit layout plan" `<Button>` in the top action row, next to the existing Sync button.
   - **Disabled** when `editable: false` (read from the edit-context, or — to avoid an extra fetch on the detail view — from a `definition.slug`-derived predicate that mirrors the server's `editable` rule).
   - **Disabled** when the instance has a non-terminal `layout_plan_commit` or `connector_sync` job in flight (the existing `runningJobs` query already powers this for Sync; the button reuses the same gate). The tooltip points at the running job, same affordance as Sync.

5. **Workflow-style guard rails reused**:
   - The existing `assertNoBlockerWarnings` + `assertUniqueEntityTargets` + drift gating in `LayoutPlanCommitService.commit` (server-side) catch ineligible plans on recommit. The frontend doesn't replicate them — it relies on the route's error envelope and surfaces `LAYOUT_PLAN_BLOCKER_WARNINGS` / `LAYOUT_PLAN_DRIFT_*` codes as inline alerts on the editor, the way the existing new-connector workflows already do.

### Out of scope

- **Plan-history / supersede surface.** PATCH edits the same row in place; there's no UI for "view prior revisions" or "rollback to revision N" yet. Spec'd separately if needed.
- **Interpret-from-current-plan.** The new edit view does NOT re-run `LayoutPlanInterpretService.analyze`. The user opens with the committed plan and edits it directly; if they want a fresh interpret, they delete the connector and start over. (We can add an "Re-run interpret" button in a follow-up — easy bolt-on once the GET endpoint exists.)
- **File-upload re-upload from inside the edit view.** When `editable: false` for a file-upload connector, we show a notice ("Source files have been cleaned up — to edit the layout, create a new connector instance") and link to the file-upload wizard. Replacing the existing connector's workbook via a fresh upload is a separate flow.
- **Cross-connector recommit semantics.** The recommit pipeline is unchanged — the existing `LayoutPlanCommitService.commit` runs against the resolved workbook + the patched plan. No new mode flags, no new job type.

---

## File-upload editability

The Google Sheets and Microsoft Excel connectors can always re-read their source workbook on demand (their `resolveWorkbook` calls the external API). The file-upload path is different — `FileUploadSessionService.resolveWorkbook(uploadSessionId)` reads from Redis with an S3 fallback; the S3 fallback works only while the original upload rows still exist, but per the `file_uploads.status` state machine, "committed" → "S3 object deleted." After that, the workbook is genuinely unrecoverable.

The edit-context endpoint encodes this as `editable: false` + a `reason` ("Source files removed after commit") for file-upload instances whose `file_uploads` rows have been swept. The frontend renders a notice instead of the editor. We DON'T attempt to undelete or to disable the S3 sweep — that's a separate retention-policy decision.

Once we want to support edit for file-upload too, the options are: (a) bump retention so the S3 objects stick around longer, (b) re-derive `WorkbookData` from the wide-table rows themselves (lossy — only the projected `c_*` columns survive), or (c) require the user to re-upload. None of those land in this spec.

---

## Surface

### `apps/api/src/routes/connector-instance-layout-plans.router.ts` (edit)

Add a route:

```
GET /api/connector-instances/:connectorInstanceId/layout-plan/edit-context
```

Response payload:

```ts
interface LayoutPlanEditContextResponsePayload {
  plan: LayoutPlan;
  planId: string;
  connectorDefinitionSlug: string;
  workbookPreview: WorkbookPreview;
  editable: boolean;
  /** Set when `editable: false`. Stable code + human message. */
  reason?: {
    code: string;
    message: string;
  };
}
```

`WorkbookPreview` is the same shape the `parse` / `interpret` paths return — every consumer in `apps/web` already knows it.

### `apps/api/src/services/connector-instance-layout-plans.service.ts` (edit)

`static async getEditContext(connectorInstanceId, organizationId)`:
1. `ensureInstanceInOrg`.
2. Load the current plan via `findCurrentByConnectorInstanceId`.
3. Load the connector definition to get `slug`.
4. Try to build a `workbookPreview`:
   - Build the same `workbookSource` discriminator `prepareDraftCommit` already builds (uploadSession ID for file-upload, instance ID for cloud-spreadsheet connectors).
   - Call `LayoutPlanDraftService.resolveWorkbookBySource(workbookSource, organizationId)` to get a `WorkbookData`.
   - Adapt to `WorkbookPreview` via the same `toWorkbookPreview` helper the parse path uses.
5. If step 4 throws with a known "source removed" error, return `editable: false` + `reason: { code: "SOURCE_REMOVED", message: ... }`. Any other throw propagates.

### `apps/web/src/api/connector-instance-layout-plans.api.ts` (new)

```ts
export const connectorInstanceLayoutPlans = {
  getEditContext: (connectorInstanceId: string) =>
    useAuthQuery<LayoutPlanEditContextResponsePayload>({
      queryKey: queryKeys.connectorInstanceLayoutPlans.editContext(
        connectorInstanceId
      ),
      url: `/api/connector-instances/${connectorInstanceId}/layout-plan/edit-context`,
    }),

  patch: () =>
    useAuthMutation<LayoutPlanResponsePayload, { connectorInstanceId; planId; body }>({
      url: (vars) =>
        `/api/connector-instances/${vars.connectorInstanceId}/layout-plan/${vars.planId}`,
      method: "PATCH",
      body: (vars) => vars.body,
      mutationOptions: {
        onSuccess: (_, vars) =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorInstanceLayoutPlans.root,
          }),
      },
    }),

  recommit: () =>
    useAuthMutation<JobEnqueueResponsePayload, { connectorInstanceId; planId }>({
      url: (vars) =>
        `/api/connector-instances/${vars.connectorInstanceId}/layout-plan/${vars.planId}/commit`,
      method: "POST",
      body: () => undefined,
      mutationOptions: {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.connectorInstances.root,
          }),
      },
    }),
};
```

Slot into `sdk.connectorInstanceLayoutPlans`.

### `apps/web/src/api/keys.ts` (edit)

Add:

```ts
connectorInstanceLayoutPlans: {
  root: ["connectorInstanceLayoutPlans"] as const,
  editContext: (id: string) =>
    ["connectorInstanceLayoutPlans", "editContext", id] as const,
},
```

### `apps/web/src/routes/_authorized/connectors.$connectorInstanceId.layout-plan.edit.tsx` (new)

TanStack `createFileRoute` that mounts `<EditLayoutPlanView connectorInstanceId={params.connectorInstanceId} />`. Standard `_authorized`-nested route; no extra params.

### `apps/web/src/views/EditLayoutPlan.view.tsx` (new)

```
EditLayoutPlanView (container; wires SDK + state)
  └─ EditLayoutPlanViewUI (pure; takes props)
       └─ RegionEditorUI (existing module)
```

Container responsibilities:
- `sdk.connectorInstanceLayoutPlans.getEditContext(connectorInstanceId)` for the initial fetch.
- Local state: working copy of regions (derived from `plan.regions` at mount; mutated via the standard RegionEditor callbacks).
- `loadSlice` dispatched by `connectorDefinitionSlug`: file-upload → `sdk.fileUploads.sheetSlice`, google-sheets → `sdk.googleSheets.sheetSlice`, microsoft-excel → `sdk.microsoftExcel.sheetSlice`. Each takes a slightly different shape on its first argument; the dispatcher hides it.
- `onSave` → builds the patched plan (regions + workbookFingerprint), calls `patch.mutateAsync`, fires a toast.
- `onCommit` → calls `recommit.mutateAsync`, navigates to `/connectors/:connectorInstanceId` (detail view) on the 202 so the user lands on the page that already shows the running-job alert.

UI responsibilities (pure):
- Top bar with "Save draft" / "Commit" / "Cancel" buttons.
- Inline `<Alert>` for `LAYOUT_PLAN_BLOCKER_WARNINGS` / `LAYOUT_PLAN_DRIFT_*` errors returned by recommit. The existing new-connector workflows already render these — reuse the components.
- When `editable: false`, render a `<Alert severity="info">` with the reason + a link to `/connectors/new/file-upload` (or wherever the matching wizard lives).

### `apps/web/src/views/ConnectorInstance.view.tsx` (edit)

Add an "Edit layout plan" button next to the existing Sync button in the actions row. Click → `navigate({ to: "/connectors/$connectorInstanceId/layout-plan/edit" })`. Disabled rules (tooltip on each):
- Connector is in a non-terminal lock-job state (mirrors Sync's existing gate).
- Connector definition slug is one the edit flow doesn't support (use the same `editable` predicate the backend uses).

No new permission checks — the existing route-level org-scope guard on the new GET endpoint is authoritative.

---

## Concept changes

### "Edit" is a thin wrapper, not a workflow rewrite

The new-connector workflows (`FileUploadConnectorWorkflow`, etc.) own multiple steps: connect → upload/select-sheet → interpret → review → commit. The edit flow only needs the *region editor* part — there's no upload, no interpret, no review pass. So the edit view sidesteps the workflows entirely and mounts `RegionEditorUI` directly. This keeps the new surface small (one new route, one new view, one container).

We pay a small cost: the edit view doesn't get the workflows' other affordances (e.g., the workflow-specific drift banner copy). We accept that for v1; if the gap matters in practice, the next iteration factors a `RegionEditorWithLifecycle` module out of the three workflows and reuses it here too.

### Save vs. Commit semantics

PATCH and recommit are two distinct operations and the UI surfaces them separately:

- **Save draft** (PATCH) — persists the plan revision *without* re-running the records pipeline. The user can iterate on bindings / regions / identity / drift tolerance, save mid-way, leave, come back. Useful for big plans where the commit pipeline is expensive.
- **Commit** (recommit) — re-runs `LayoutPlanCommitService.commit` against the persisted plan + the resolved workbook. Records are rewritten. This is the destructive operation; the button reuses the existing 202 + SSE flow so the user lands on a job-watching view.

Saving without committing leaves the connector's records out-of-sync with the new plan until the user commits or the next sync runs. That's intentional — the user explicitly chose to defer. The detail view shows a chip ("Plan edited — commit to apply") when `plan.updated > last_successful_commit_at`. (Out of scope for v1; revisit if users get confused.)

### Error surfacing

Recommit can fail for the same reasons draft commit can:
- `LAYOUT_PLAN_BLOCKER_WARNINGS` — plan carries blocker warnings the user hasn't resolved.
- `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` / `LAYOUT_PLAN_DRIFT_BLOCKER` / `LAYOUT_PLAN_DRIFT_WARN` — drift gating.
- `LAYOUT_PLAN_DUPLICATE_ENTITY` — C1 violation.
- `LAYOUT_PLAN_NOT_FOUND` — plan deleted underneath us.

All of these come back through the standard error envelope. The view renders them inline as a dismissable `<Alert>` near the Commit button — same component the new-connector workflows already use. The user fixes the plan and clicks Commit again.

The recommit endpoint enqueues a job, so the FIRST failure path (synchronous validation in `prepareRecommit`) returns 4xx with the code; the SECOND failure path (worker-time replay / drift / write) returns 202 with a `jobId`, and the failure surfaces via SSE on the detail view. The edit view doesn't need to handle the latter — it's already left for the detail view.

---

## Tests

Placement matches the existing repo conventions: backend integration in `apps/api/src/__tests__/__integration__/routes/`, frontend unit in `apps/web/src/__tests__/`.

### Backend (`connector-instance-layout-plans.router.integration.test.ts`, edit)

1. **GET edit-context, google-sheets path**: seed a connector instance with slug `google-sheets`, mock the GoogleSheetsConnectorService.resolveWorkbook fixture, GET the endpoint, assert `{ plan, planId, slug, workbookPreview, editable: true }`.
2. **GET edit-context, microsoft-excel path**: same, with slug `microsoft-excel`.
3. **GET edit-context, file-upload with source available**: seed an upload session + `parsed`-status uploads, GET, assert `editable: true` and the preview reflects the upload.
4. **GET edit-context, file-upload with source removed**: seed an upload session whose uploads are `committed` (S3 sweep marked the rows committed), GET, assert `editable: false` + `reason.code === "SOURCE_REMOVED"`.
5. **GET edit-context, plan missing**: instance exists but no plan row, GET returns 404 `LAYOUT_PLAN_NOT_FOUND`.
6. **GET edit-context, cross-org**: instance in another org, GET returns 404 `CONNECTOR_INSTANCE_NOT_FOUND`.

### Frontend SDK (`apps/web/src/__tests__/api/connector-instance-layout-plans.api.test.ts`, new)

7. `getEditContext` hits the right URL + returns the payload unwrapped.
8. `patch` fires PATCH to the right URL + invalidates `connectorInstanceLayoutPlans.root`.
9. `recommit` fires POST to the right URL + returns the 202 envelope.

### Frontend view (`apps/web/src/__tests__/views/EditLayoutPlan.view.test.tsx`, new)

10. Mount → fetches edit-context → renders `RegionEditorUI` with regions derived from the plan + the workbook preview as `workbook`.
11. Save click → fires PATCH with the current regions; toast renders on success.
12. Commit click → fires recommit, navigates to `/connectors/:id` on 202 success.
13. `editable: false` → renders a notice + a link to the new-connector wizard, does NOT render `RegionEditorUI`.
14. Recommit returns 409 `LAYOUT_PLAN_BLOCKER_WARNINGS` → renders the inline `<Alert>`; the editor stays mounted so the user can fix and retry.

### Frontend entry-point (`apps/web/src/__tests__/views/ConnectorInstance.view.test.tsx`, edit)

15. "Edit layout plan" button renders when the connector definition slug is supported AND no lock-job is running.
16. Button is disabled (tooltip points at the running job) when a non-terminal `layout_plan_commit` is in flight.
17. Button hidden / disabled for slugs that don't support edit (or: shown but routes to the "re-upload" affordance for file-upload — same gate the backend uses).

---

## Acceptance criteria

- [ ] All new tests pass; existing integration + unit suites stay green.
- [ ] `npm run lint` + `npm run type-check` clean.
- [ ] Manual smoke: spin up `npm run dev`, complete a Google Sheets connector commit, navigate to the connector detail view, click "Edit layout plan", change a column binding, click Save → toast shows, plan persists; reload the edit view → the new binding is reflected; click Commit → land on the detail view with a running-job alert; job completes → records reflect the new binding.
- [ ] Manual smoke: file-upload connector committed weeks ago (S3 sweep has run) → "Edit layout plan" button is disabled with a tooltip; navigating to the route directly renders the "Source removed" notice.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `editable: false` for file-upload surprises users who expect parity with cloud connectors. | Tooltip + notice explain *why* (source files cleaned up post-commit). Follow-up: bump the S3 retention or add a re-upload affordance. |
| `resolveWorkbook` for Google Sheets / Excel hits the live source on every edit-view mount — a slow remote API stalls the page. | Same path the existing interpret flow uses; not a new latency surface. Wire a loading skeleton in the view; if the GS/Excel APIs are flaky in practice, layer a Redis-backed cache later. |
| PATCH allows a partial body that re-validates the merged plan; a malformed save bricks the row until the user re-edits. | PATCH already throws 400 on schema violation. The view surfaces the validation errors inline so the user can fix and re-save. |
| Recommit fails partway through the records-write phase and leaves the wide table inconsistent. | Existing `LayoutPlanCommitService.commit` already wraps every write under per-entity advisory locks + a transaction; failure → rollback. No new code path. |
| User edits an old plan revision (some other actor recommitted in the background). | PATCH targets a specific `planId`; if the row was superseded, the editor's stale snapshot's `planId` no longer matches the current row. The PATCH then no-ops or 404s. The view detects this on next fetch and shows a "Plan was updated elsewhere — reload" notice. (Phase 2 polish; v1 just shows the route's error message.) |

**Rollback**: revert the merge commit. The new GET endpoint is unused outside the edit view; PATCH + recommit existed before this feature and stay. Frontend route is additive.

---

## Cross-references

- `apps/api/src/routes/connector-instance-layout-plans.router.ts` — host for the new GET; the existing PATCH (line ~313) and recommit POST (line ~460) endpoints stay.
- `apps/api/src/services/connector-instance-layout-plans.service.ts` — adds `getEditContext`.
- `apps/api/src/services/layout-plan-draft.service.ts` — `resolveWorkbookBySource` (line ~448) is reused unchanged; that's the dispatcher the new GET delegates to.
- `apps/web/src/modules/RegionEditor/RegionEditor.component.tsx` — mounted directly by the new view.
- `apps/web/src/modules/RegionEditor/utils/plan-regions-to-drafts.util.ts` — converts `LayoutPlan.regions` → the editor's `RegionDraft[]` shape (used by every new-connector workflow today; reuse here).
- `apps/web/src/views/ConnectorInstance.view.tsx` — host for the entry-point button.
- `docs/SPREADSHEET_PARSING.backend.spec.md` — defines `LayoutPlan`, the commit pipeline, and `connector_instance_layout_plans`.
