# Station view attachments + empty-station warnings — Plan

**Implements the #674 contract in six test-first slices.** Shared logic and contracts come first. Then the server write path, the read path and the attach-route realignment, then the agent-facing text, then the web pickers and chips, and finally the surfaces and help content.

Spec: `docs/STATION_VIEW_ATTACHMENTS.spec.md`. Discovery: `docs/STATION_VIEW_ATTACHMENTS.discovery.md`. Issue: #674. Builds on #599 (`station_views`, curated views) and #621 (the per-object `PermissionSet`).

There are 6 slices. Each one ships behind a green test suite and leaves the repo compilable. They land as **commits on `feat/674-station-view-attachments`**: one feature, one PR (#675), per `CLAUDE.md` → "Phase = commit, not PR".

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration -- --testPathPattern "<suite>"
cd apps/web && npm run test:unit
```

Every slice follows the same loop:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. At the boundary, run `npm run lint && npm run type-check`, plus a root `npm run build` whenever core changed (core changes ripple into web/site fixtures).
5. Move to the next slice.

**Sequencing rationale:**
1. **Pure core pieces:** the body-schema additions (additive, optional), the audit action and the shared copy function. Nothing downstream changes type yet.
2. **Write path:** the security core (permission rule, preservation, atomicity, audit). It depends only on slice 1's body schema.
3. **Read path:** the GET response shape (`canRead`) changes here, together with every consumer's fixtures, so the type ripple lands in one green commit. The attach-route realignment reuses slice 2's service.
4. **Agent text:** needs slice 3's `listForStation` counts and slice 1's copy function.
5. **Web building blocks and dialogs:** need slice 1's body schema and slice 3's payload.
6. **Detail and portal surfaces, plus help content:** compose slice 5's components on slice 3's payload. The docs land last, describing what shipped.

---

## Slice 1 — Core contracts, audit action, shared empty-station copy

Adds the optional `curatedViewIds` to the create/update bodies, the `station.attachments.change` audit action, and `describeStationAttachmentGaps`. All three are additive, with no consumer changes yet.

**Files**

- Edit: `packages/core/src/contracts/station.contract.ts`: `curatedViewIds?: string[]` on `CreateStationBodySchema` and `UpdateStationBodySchema` (the refine counts it).
- Edit: `packages/core/src/models/audit-log.model.ts`: `"station.attachments.change"` in `AUDIT_ACTIONS`.
- New: `packages/core/src/content/station-attachments.util.ts`: `StationAttachmentCounts` and `describeStationAttachmentGaps` (spec Surface). Exported from the content barrel.
- Tests: `packages/core/src/__tests__/contracts/station.contract.test.ts`, and new `packages/core/src/__tests__/content/station-attachments.util.test.ts`.

**Steps**

1. **Tests (spec cases 1 and 3; 16 for the copy function).**
   - Create and Update accept `curatedViewIds`, and Update with only `curatedViewIds` passes the refine.
   - `AuditActionSchema` accepts the new action.
   - Every `missing` and `noAccess` branch matches the exact sentences, and an unattached kind is never reported as no-access.
   - Run them; they fail.
2. **Implement** the schema fields, the enum value and the function. Run; green.
3. Lint, type-check, then a root `npm run build`: nothing consumes these yet, so web/site fixtures should be unaffected.

**Done when:** cases 1, 3 and 16 pass and the root build is green.

**Risk:** none. Everything is additive and optional.

---

## Slice 2 — Server write path: permission rule, preserving diff, transaction, audit

Station create, update and delete enforce `edit` on the station plus `read` on every attachment, preserve unreadable attachments, and write both attachment kinds by diff (soft delete) in one transaction. Each change is audited.

**Files**

- New: `apps/api/src/services/station-attachment.service.ts`: `assertAttachable`, `applyDiff` (spec Surface). `listForStation` arrives in slice 3.
- Edit: `apps/api/src/db/repositories/station-views.repository.ts` and `station-instances.repository.ts`: `insertManyIgnoreConflicts` (with `ON CONFLICT … WHERE deleted IS NULL`) and `softDeleteByStationAnd…`.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: `STATION_ATTACHMENT_NOT_READABLE`.
- Edit: `apps/api/src/routes/station.router.ts`:
  - **POST and PATCH:** one `loadSet`, then `assertAttachable`, then `DbService.transaction` around the station row, the toolpacks and both `applyDiff` calls. Post-commit, fail-open `AuditService.record`. **The `hardDelete` loop is removed.**
  - **DELETE:** soft-deletes `station_views` and `station_instances` inside the existing transaction.
  - **`@openapi`:** request bodies and the 403.
- Edit: `apps/api/src/config/swagger.config.ts`: body schemas.
- Tests:
  - new `apps/api/src/__tests__/services/station-attachment.service.test.ts`;
  - new `apps/api/src/__tests__/__integration__/routes/station-attachments.router.integration.test.ts`;
  - the existing station router tests, adjusted where they assumed hard-delete replace.

**Steps**

1. **Tests (spec cases 4, 5, 6–11, 13 and 14).**
   - Unit: `assertAttachable` and `applyDiff`.
   - Integration: create attaches and audits; an unreadable view gives 403 with no station row; each field updates independently; removal is a soft delete; preservation (user A / user B with V1 and V2); concurrent adds leave one row; a user without `write` gets 403; delete soft-deletes.
   - Run them; they fail.
2. **Implement** the service, the repositories, the code and the route rewiring. Run; green.
3. Run the existing `station.router` integration suites. Update any that asserted hard-delete semantics, recording why in each test's description.
4. Lint and type-check.

**Done when:** cases 4–11, 13 and 14 pass, and the existing station suites are green.

**Risk:**
- **Behaviour change:** connector links go from replace-all to diff with soft delete. Tests 8–10 guard it.
- **Seeded data:** the integration fixtures need two users with distinct `read` grants on views. Reuse the `attachCuratedView` helper (`__integration__/utils/application.util.ts:278`).

---

## Slice 3 — Read path: all attachments with `canRead`; attach/detach realigned

The station GET returns every attached connector and view with `canRead`, through `include=curatedView,connectorInstance`. The standalone attach/detach routes adopt the station-edit rule.

**Files**

- Edit: `packages/core/src/contracts/station.contract.ts`: `StationViewWithCuratedViewSchema` (new), `canRead` on `StationInstanceWithConnectorInstanceSchema`, and `views` on the GET payload.
- Edit: `apps/api/src/services/station-attachment.service.ts`: `listForStation`, with one batched object read per kind and one `PermissionSet`.
- Edit: `apps/api/src/routes/station.router.ts`: GET uses `listForStation`, and `include` gains `curatedView`.
- Edit: `apps/api/src/routes/curated-view.router.ts`:
  - **Attach** requires station `write` plus view `read`, uses `insertManyIgnoreConflicts`, and audits.
  - **Detach** requires station `write`, and audits.
- Edit: `apps/api/src/config/swagger.config.ts`: register `StationViewWithCuratedView` and update the GET response.
- Edit, for the **type ripple**: every web and test fixture typed as `StationGetResponsePayload` or `StationInstanceWithConnectorInstance` gains `canRead: true`. Grep both apps for these.
- Tests:
  - the integration suite from slice 2, extended;
  - `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`;
  - `packages/core/src/__tests__/contracts/station.contract.test.ts`.

**Steps**

1. **Tests (spec cases 2, 12 and 15).**
   - Core: the payload requires `canRead`.
   - Integration: the GET returns an unreadable view with `canRead: false` and its label; attach with station `edit` and view `read` returns 201, view `write` without station `edit` returns 403, and detach with station `edit` works.
   - Run them; they fail.
2. **Implement** the payload and `listForStation`, rewire GET, realign attach/detach, and update the fixtures. Run; green.
3. Lint, type-check, then a **root `npm run build`**. The response type changed, so a web or site fixture miss shows up here.

**Done when:** cases 2, 12 and 15 pass, and the root build and type-check are green across all packages.

**Risk:**
- **The type ripple:** a missed fixture fails the root build. Make it a deliberate grep, not trial and error.
- **The attach route's permission change:** called out in the PR.

---

## Slice 4 — Agent-facing empty-station situations

The system prompt and `platform_help` report missing and inaccessible attachments using slice 1's copy function, with counts from slice 3.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts`: `StationContext.attachments`; `buildSystemPrompt` replaces the "No entities attached" line with `missing` / `noAccess`.
- Edit: `apps/api/src/services/portal.service.ts` (`buildStationContext`): fills `attachments` from `StationAttachmentService.listForStation`.
- Edit: `apps/api/src/tools/platform-help.tool.ts`: the `Situation` union, the match order, `gatherFindings` counts and prose (spec Surface). `no_entities` is removed.
- Tests: `apps/api/src/__tests__/prompts/system.prompt.test.ts` and `apps/api/src/__tests__/tools/platform-help.tool.test.ts`, plus any `buildStationContext` fixtures that need `attachments`.

**Steps**

1. **Tests (spec case 17).**
   - The prompt cases: both missing; views missing with connectors present; no access; entities listed otherwise.
   - The `platform_help` situation order and exact prose. This replaces the old `no_entities` test.
   - Run them; they fail.
2. **Implement.** Run; green. Then run the portal and analytics unit suites that build a `StationContext`.
3. Lint and type-check.

**Done when:** case 17 passes, and every existing prompt and tool suite is green.

**Risk:**
- **Fixtures:** `StationContext` is constructed in several test fixtures, so `attachments` must be added to each (type-check finds them).
- **Prompt pinning:** check `system.prompt.test.ts` for prompt-text tests that might pin the old line.

---

## Slice 5 — Web building blocks and the station dialogs

Adds the no-access chip, the async view picker and the attachment alerts, then wires the picker into the create and edit dialogs.

**Files**

- New: `apps/web/src/components/AttachmentChip.component.tsx` (pure UI, `AttachmentChipUI`).
- New: `apps/web/src/components/CuratedViewPicker.component.tsx` (`CuratedViewPicker` + `CuratedViewPickerUI`, wrapping `MultiAsyncSearchableSelect` over `sdk.curatedViews.list`).
- New: `apps/web/src/components/StationAttachmentAlerts.component.tsx` (pure UI, renders `describeStationAttachmentGaps(...).missing`).
- Edit: `apps/web/src/components/CreateStationDialog.component.tsx`: the view picker after the connector picker, `curatedViewIds` in the payload, and the "no views selected" helper.
- Edit: `apps/web/src/components/EditStationDialog.component.tsx`: seed both pickers from `canRead` rows only (fetch with `include=connectorInstance,curatedView`), and diff and send the readable sets.
- Edit: `apps/web/src/api/stations.api.ts` (the include), plus `onSuccess` invalidation of `stations.root` and `curatedViews.root` at the station create/update and curated-view attach/detach call sites.
- New: stories under `apps/web/src/stories/` for the three components.
- Tests:
  - new `AttachmentChip.test.tsx`, `CuratedViewPicker.test.tsx` and `StationAttachmentAlerts.test.tsx`;
  - edits to `CreateStationDialog.test.tsx`, `EditStationDialog.test.tsx` and `StationDialogCollisions.test.tsx` (the `sdk.curatedViews.list` mock).

**Steps**

1. **Tests (spec cases 18–22 and 24).**
   - The chip, readable and unreadable: error colour, lock, tooltip, aria and not clickable.
   - The picker: async options, `onChange` and labels.
   - The alerts: one combined, each single, none.
   - Create: sends `curatedViewIds`, and shows the hint.
   - Edit: seeds readable rows only, and sends changes only.
   - The collision mock.
   - Run them; they fail.
2. **Implement.** Run; green.
3. Lint and type-check. The web lint gate is zero warnings.

**Done when:** cases 18–22 and 24 pass.

**Risk:** the `MultiAsyncSearchableSelect` label hydration for already-selected ids. The labels come from the GET (`selectedLabels`), never from a second fetch.

---

## Slice 6 — Station detail + portal header surfaces; help content

Shows both attachment rows with chips and the single warning on the station detail page and in the portal header, then brings the help content in line.

**Files**

- Edit: `apps/web/src/views/StationDetail.view.tsx`:
  - the include;
  - a "Views" row beside "Connectors", both rendered with `AttachmentChipUI`;
  - rows shown with `—` when empty;
  - `StationAttachmentAlertsUI` replaces the `:300-305` alert.
- Edit: `apps/web/src/views/Portal.view.tsx` (`PortalHeaderMeta`): the same.
- Edit: `packages/core/src/content/glossary.util.ts`: a new **Curated View** term, and the "Station" entry mentions views.
- Edit: `packages/core/src/content/faq.util.ts`: `:55-57` and `:261-263`.
- Edit: `apps/web/src/utils/getting-started.util.ts`: `:31-35`.
- Edit: `apps/web/src/utils/glossary-routes.util.ts`, if the new term gets a route.
- Tests:
  - new `apps/web/src/__tests__/StationDetail.view.test.tsx`;
  - `apps/web/src/__tests__/Portal.view.test.tsx`;
  - `packages/core/src/__tests__/content/glossary.util.test.ts` and `faq.util.test.ts`;
  - `apps/web/src/__tests__/glossary-routes.util.test.ts`.

**Steps**

1. **Tests (spec cases 23 and 25).**
   - Both surfaces render Views and Connectors rows with no-access chips, plus the single combined or per-kind alert from the payload.
   - The glossary term and its related terms, the FAQ clauses and the route map.
   - Run them; they fail.
2. **Implement.** Run; green.
3. Lint, type-check, then a root `npm run build` (core content changed, and it ships to `apps/site`).

**Done when:** cases 23 and 25 pass, and the root build is green.

**Risk:** the glossary is shared with the marketing site (#311), so the site build must pass with the new term.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | Body `curatedViewIds`, audit action, `describeStationAttachmentGaps` | core unit tests (1, 3, 16); root build |
| 2 | Permission rule, preserving diff, transaction, audit, delete lifecycle | api unit + integration tests (4–11, 13, 14); existing station suites |
| 3 | GET with all attachments + `canRead`; attach/detach realigned | api integration (2, 12, 15); **root build** (type ripple) |
| 4 | Agent situations + prompt lines | api unit (17) |
| 5 | Chip, picker, alerts; both dialogs | web unit (18–22, 24) |
| 6 | Detail + portal surfaces; help content | web + core unit (23, 25); root build |

## Cross-slice notes

- **The core-to-web ripple:** slice 3 is the only slice that changes a response type, and it updates every fixture in the same commit. Run the root `npm run build` before pushing it, not just the per-package type-check.
- **Permission framing:** every test and every piece of copy states conditions as permissions ("a user with `write` on the station", "views the user can `read`"), never as role names.
- **Cache invalidation:** station create/update and curated-view attach/detach invalidate `stations.root` and `curatedViews.root` (slice 5).
- **Doc sync:** the glossary, FAQ and getting-started text land in slice 6. The OpenAPI blocks land with their routes (slices 2 and 3).
  - **System prompt:** the text change is in slice 4.
  - **`builtin-toolpacks.ts` mirror:** `platform_help`'s *description* doesn't change, so the mirror has nothing to update. Confirm this in slice 4.
- **Phase docs after merge:** the smoke and adversarial checklists come after slice 6, through `/smoke 674` and `/adversarial-review 674`.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice. It begins only once discovery, spec and plan are reviewed and confirmed.
