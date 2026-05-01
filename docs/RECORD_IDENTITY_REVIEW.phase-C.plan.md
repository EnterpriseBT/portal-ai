# Phase C — Soften Banner Copy + Non-blocking Sync Button

Frontend-only phase. Replaces the `severity="warning"` "One-shot import only" banner in the gsheets review step with a `severity="info"` advisory, and drops the rowPosition-driven `syncEligible: false` disable on the connector-instance Sync button. Tooltip copy on the button switches from a blocker explanation to a soft consequence note.

Requires Phase B (the backend now reports `syncEligible: true` and `identityWarnings`); does not require Phase A. Can ship the same release as Phase B if the schedule packages them together.

## C.1 Goals

1. `GoogleSheetsReviewStepUI` renders the `rowPosition` notice with `severity="info"` and copy that explains "every sync reaps and re-creates records in this region — pick an identity field to keep records stable". The notice does not gate Commit (already non-blocking; copy change only).
2. `ConnectorInstanceSyncButtonUI` is enabled when `syncEligible: true` regardless of `identityWarnings`. When the instance carries any `identityWarnings`, the button's tooltip says "Re-sync recreates all records in the affected region(s)." instead of the previous blocking copy.
3. The error toast that fires today on a 409 `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` no longer needs the special-case (Phase B stops emitting the code). Remove or simplify the conditional.

## C.2 Non-goals

- Identity selector dropdown (Phase D).
- Schema / interpret changes (Phase A).
- Backend gate logic (Phase B).
- New telemetry on rowPosition usage (deferred follow-up per spec §9 Q4).

## C.3 TDD plan

Tests live in `apps/web/src/`. Run via `npm run test:unit` from the workspace root or `apps/web` directly.

### C.3.1 GoogleSheetsReviewStep banner
File: `apps/web/src/workflows/GoogleSheetsConnector/__tests__/GoogleSheetsReviewStep.test.tsx`

Update existing tests; do not delete them. Each currently asserts the warning banner text — flip to assert the new info-banner shape.

1. **Banner severity is `info`.** When at least one region has `identityStrategy.kind === "rowPosition"`, the rendered alert has `role="status"` (MUI sets this for `severity="info"`) and the new advisory text matches `/reaped and re-created/i`.
2. **Banner is hidden for stable plans.** No `rowPosition` regions → no advisory rendered.
3. **Banner does not block Commit.** The Commit button is enabled regardless of the banner's presence (already true; lock it in with a regression test).
4. **Region label still appears in the advisory.** The region's `proposedLabel` (or id fallback) is included in the message so the user can match the warning to the cards below.

### C.3.2 ConnectorInstanceSyncButton
File: `apps/web/src/__tests__/ConnectorInstanceSyncButton.test.tsx`

1. **Button is enabled when syncEligible is true.** Existing test stays green.
2. **Button shows advisory tooltip when identityWarnings non-empty.** New test: render with `syncEligible: true, identityWarnings: [{ regionId: "r1" }]` (the prop arrives from the connector-instance fetch). Hover surfaces the new copy `/recreates all records/i`.
3. **Button stays disabled when syncEligible is false.** Existing disabled-state test (e.g. for `LAYOUT_PLAN_NOT_FOUND`) keeps its current copy and remains red on the button. No regression.
4. **No "positional row IDs" copy.** Grep the test for the old string; remove the assertion. Replace with the new advisory string.

### C.3.3 Sync error / toast handler
File: locate the sync mutation hook (e.g. `apps/web/src/utils/use-connector-instance-sync.util.ts`) and any toast that special-cased `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`.

1. **No special case for the deprecated code.** Remove conditional toast text branches that match `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`. Generic error path stays.

## C.4 Implementation steps

### Step 1 — `GoogleSheetsReviewStep` banner
File: `apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsReviewStep.component.tsx`

Today (lines 41-58 approx) it renders an `Alert severity="warning"` with `<AlertTitle>One-shot import only</AlertTitle>`. Replace with:

```tsx
<Alert severity="info" role="status" variant="outlined">
  <AlertTitle>No stable identity for {rowPositionRegions.length === 1 ? "this region" : "these regions"}</AlertTitle>
  <p>
    {rowPositionRegions.length === 1
      ? "This region has no identity field"
      : "These regions have no identity field"}
    : {rowPositionRegions.map((r) => regionLabel(r)).join(", ")}.
  </p>
  <p>
    Every sync will reap and re-create records in {rowPositionRegions.length === 1 ? "it" : "them"}.
    To keep records stable across syncs, pick an identity field above (or on the next phase of the editor).
  </p>
</Alert>
```

When Phase D ships, swap `(or on the next phase of the editor)` for a direct link/anchor to the IdentityPanel within the region card.

### Step 2 — Drop the rowPosition disable in `ConnectorInstanceSyncButton`
File: `apps/web/src/components/ConnectorInstanceSyncButton.component.tsx`

The component currently consumes `syncEligible: boolean`. Phase B already keeps it `true` for rowPosition plans, so the button is enabled. The change here is:

- Accept a new `identityWarnings?: { regionId: string }[]` prop (passed from the parent `ConnectorInstance.view.tsx`, which reads it from the connector-instance fetch).
- When `identityWarnings.length > 0` and `syncEligible === true`, wrap the button in a `Tooltip` with the advisory copy `Re-sync recreates all records in the affected region(s).`
- When `syncEligible === false`, keep the existing tooltip copy for whichever blocker fired (typically `LAYOUT_PLAN_NOT_FOUND` post-Phase-B).

Drop the constant `"This connector uses positional row IDs and can't be re-synced. Re-edit the regions to add an identifier column."` (line 9-ish in the component as of writing). It is no longer reachable.

### Step 3 — Wire `identityWarnings` from view → button
File: `apps/web/src/views/ConnectorInstance.view.tsx`

Read `identityWarnings` from the connector-instance shape (added in Phase B step 6) and pass it down. The view already destructures `syncEligible`; add `identityWarnings` alongside.

### Step 4 — Sync mutation hook
File: `apps/web/src/utils/use-connector-instance-sync.util.ts` (or wherever the sync POST is wrapped)

Remove any branch that matches the `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` ApiCode in error formatting. The generic error toast is enough.

## C.5 Files touched

```
apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsReviewStep.component.tsx
apps/web/src/workflows/GoogleSheetsConnector/__tests__/GoogleSheetsReviewStep.test.tsx
apps/web/src/components/ConnectorInstanceSyncButton.component.tsx
apps/web/src/__tests__/ConnectorInstanceSyncButton.test.tsx
apps/web/src/views/ConnectorInstance.view.tsx
apps/web/src/utils/use-connector-instance-sync.util.ts
```

If a Storybook story exists for `GoogleSheetsReviewStep` or `ConnectorInstanceSyncButton`, update fixtures so the new copy renders correctly:

```
apps/web/src/workflows/GoogleSheetsConnector/stories/*.stories.tsx
apps/web/src/stories/*.stories.tsx
```

## C.6 Verification (acceptance for Phase C)

1. `npm run test:unit` clean in `apps/web` (full suite); type-check + lint clean.
2. Storybook renders the new banner with `severity="info"` and the new copy. Run `npm run storybook` and visit the relevant story; screenshot for the PR.
3. Browser end-to-end: open a connector instance whose plan has at least one rowPosition region.
   - The detail view shows the Sync button **enabled**.
   - Hovering the Sync button surfaces the advisory tooltip.
   - Clicking Sync triggers a job that completes successfully and renders the result toast (`X added, Y updated, Z unchanged, W removed`).
4. Browser end-to-end: open the gsheets connector workflow on a plan whose interpret pass settled on rowPosition.
   - The review step shows the new info banner.
   - The Commit button is enabled.
   - Committing succeeds.

## C.7 Risks and mitigations

- **Banner severity downgrade may slip past users.** The banner is now `info` rather than `warning`. Mitigation: keep the title prominent ("No stable identity for this region") and link to the identity-picker (Phase D). The non-blocking nature is the goal — users have explicitly opted into reap+recreate semantics by ignoring it.
- **Tooltip copy fragmentation.** If the parent view fails to pass `identityWarnings`, the button shows no advisory — feature gates silently. Mitigation: typecheck the prop as required-when-eligible (`identityWarnings: { regionId: string }[]` defaulted to `[]`), so the tooltip branch is exercised by every render.
- **Stale tests assert old copy.** Existing snapshot or text-match tests on the warning banner break on string change. Mitigation: update assertions in the same PR; do not bypass `--update-snapshot` without per-snapshot review.
