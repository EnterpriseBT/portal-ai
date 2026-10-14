# Length limits on user-authored text — Plan

**TDD-sequenced implementation of the core text limits, their adoption in every request contract (with the guard that keeps it so), the API's non-contract write sites and agent tools, and the web forms that show the limit inline.**

Spec: `docs/NAME_LENGTH_LIMITS.spec.md`. Discovery: `docs/NAME_LENGTH_LIMITS.discovery.md`. Issue: #801. PR: #803.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/801-name-length-limits`**: one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, touched files only (never invoke jest directly):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd packages/spreadsheet-parsing && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
```

Each slice:
1. write failing tests;
2. make the smallest change that turns them green;
3. run the focused tests;
4. at the boundary, `npm run lint`, `npm run type-check` and `npm run format:check` in each touched package, plus a root `npm run build` after any core change (memory: a core change ripples into web/site typed fixtures);
5. move to the next slice.

**Sequencing rationale.** The limits are pure functions, the contracts consume them, and everything else consumes the contracts:
- **Slice 1:** the core module alone; nothing references it yet.
- **Slice 2:** the contracts adopt it, and the guard lands **green** in the same commit. A guard committed red would break the tree.
- **Slice 3:** the API sites and tools that don't go through a contract, plus the integration tests proving the contract caps end to end.
- **Slice 4:** the web forms with local schemas, and the docs.

There is no migration.

---

## Slice 1: core text-limits module

The constants, the three field builders, `clipToLength` and `planTextLimitIssues`, exported from `@portalai/core/contracts`. No contract uses them yet.

**Files**
- New: `packages/core/src/contracts/text-limits.contract.ts`, the spec's Surface → core module and `planTextLimitIssues`.
- Edit: `packages/core/src/contracts/index.ts` re-exports it.
- New: `packages/core/src/__tests__/contracts/text-limits.contract.test.ts`.

**Steps**
1. **Tests (spec cases 1–6).** The boundaries at 120/121, 2000/2001 and 58/59; trim and the required message; the custom field label in both messages; `clipToLength`; `planTextLimitIssues` paths for a long `targetEntityDefinitionId` and a long binding `normalizedKey`, and `[]` within limits. Run; they fail.
2. **Implement** the module. Green.
3. Lint, type-check and format:check (core).

**Done when:** cases 1–6 pass, and the module is exported but unreferenced.

**Risk:** `planTextLimitIssues` needs the `LayoutPlan` type. Core already depends on `@portalai/spreadsheet-parsing` (`packages/core/package.json:134`), and the commit-draft contract imports `LayoutPlanSchema` from it, so there's no new dependency.

---

## Slice 2: contracts adopt the limits, plus the guard

Every guarded field in the spec's adoption table composes the builders. `LayoutPlanCommitDraftRequestBodySchema` gains its `superRefine`. `name-length.guard.test.ts` lands passing.

**Files**
- Edit (core contracts): `station`, `portal`, `entity-tag`, `entity-group`, `column-definition`, `connector-entity`, `connector-instance`, `connector-instance-layout-plans`, `api-connector`, `toolpack`, `rbac-authoring`, `curated-view` and `field-mapping` `.contract.ts`, per the spec table.
- New: `packages/core/src/__tests__/contracts/name-length.guard.test.ts`.
- Edit: the existing contract test files for those schemas (e.g. `packages/core/src/__tests__/contracts/portal.contract.test.ts`).
- New or edit: a replay test in `packages/spreadsheet-parsing` (`replay` of a stored plan with a 500-character axis name).

**Steps**
1. **Tests (spec cases 7–12).**
   - One over/at-the-limit case per schema family (case 7) and the commit-draft path (case 8).
   - The guard (cases 9–11): the real tree, the nested fixture, and `EXEMPT` resolution plus the minimum match count.
   - The replay regression (case 12), which already passes and stays passing.
   - Run; cases 7–11 fail.
2. **Implement** the adoption table. Keep every non-guarded field and every `.strict()`/`.refine` as it is. Put the `.superRefine` after `.strict()`, per CLAUDE.md's ordering rule. Green.
3. **Check ripple:**
   - Run the web tests for dialogs that validate with these contracts directly (`RenamePinnedResultDialog`, `RenamePortalDialog`, `PinResultDialog`, `RegisterToolpackDialog`, `EditToolpackDialog`, `CreateEntityGroupDialog`, `EditEntityGroupDialog`, `EditColumnDefinitionDialog`, `EditConnectorEntityDialog`, `CuratedViewEditorDialog`, `NameField`, `SandboxConnectorWorkflow`).
   - Run the API unit tests for `rbac/*.tool.ts`.
   - Messages that were Zod's default now read "<Field> is required". A test asserting the old copy is updated, not the contract.
4. Lint, type-check and format:check (core); root `npm run build`.

**Done when:** cases 7–12 pass, the guard is green on the real tree, and the touched web and API tests are green.

**Risk:**
- **Trimming names:** names that weren't trimmed are trimmed now. Station, tag and group API integration tests that send padded names would change, so run their touched suites.
- **Optionals:** `nameField()` is required. On optional fields it must stay `.optional()` (a missing station name on PATCH is valid), and type-check catches a slip through the inferred body types.

---

## Slice 3: API write sites and agent tools

The paths no contract sees, plus integration tests proving the slice 2 caps at the HTTP boundary.

**Files**
- Edit:
  - `apps/api/src/services/wide-table-reconciler.service.ts`: `sanitizeColumnName` gets its byte guarantee.
  - `apps/api/src/services/connector-instance-layout-plans.service.ts`: the PATCH runs `planTextLimitIssues`.
  - `apps/api/src/services/google-sheets-connector.service.ts` and `microsoft-excel-connector.service.ts` (names at `:202`, `:354`, `:363`): `clipToLength`.
  - `apps/api/src/db/create-org.ts`: reject a name over the limit or blank.
  - `apps/api/src/tools/connector-entity-create.tool.ts`, `connector-entity-update.tool.ts`, `field-mapping-create.tool.ts`, `field-mapping-update.tool.ts`, `visualize-d3.tool.ts`, `visualize-map.tool.ts`.
- Tests:
  - the existing `sanitizeColumnName` unit test file, or a new one beside the reconciler tests;
  - the station, layout-plan and commit-draft integration tests;
  - unit tests for the provider name builders and the tools.

**Steps**
1. **Tests (spec cases 13–19).**
   - `sanitizeColumnName`: ≤ 63 bytes for long keys, distinct results for a shared 70-character prefix, `_120` suffixes, unchanged output for short keys.
   - Station POST at 121/120 characters, and PATCH resending an over-length name.
   - Plan PATCH with an over-length key override: 400, plan unchanged.
   - Commit-draft with an over-length label: 400, no instance.
   - Provider name clipping.
   - Tool rejections.
   - Run. The station and commit-draft cases already pass after slice 2. The rest fail.
2. **Implement**:
   - the clip in `sanitizeColumnName`;
   - the PATCH check, reusing the service's existing `LAYOUT_PLAN_INVALID_PAYLOAD` 400 (a service, so `invalid-request-code.guard`, which scans routes, doesn't apply);
   - the two provider name builders;
   - the `create-org` check;
   - the tool schemas (the connector-entity create tool also gains the key pattern).
   - Green.
3. Lint, type-check and format:check (api).

**Done when:** cases 13–19 pass. `db:create-org` with a 121-character `--name` fails with the usage message (a manual check, recorded for smoke).

**Risk:**
- **Unit test exposure:** `sanitizeColumnName` is used by the wide-table reconciler at every sync. The short-key "unchanged output" case is what protects existing columns.
- **Integration suite needs Stripe env:** run the touched integration files with `STRIPE_*` exported if a billing route is in the path (memory).

---

## Slice 4: web forms, RegionEditor, docs

Every local dialog schema and inline editor applies the same rule and shows it inline. CLAUDE.md records the convention.

**Files**
- Edit:
  - `apps/web/src/components/CreateStationDialog.component.tsx`, `EditStationDialog.component.tsx`, `TagFormModal.component.tsx`: name and description, with the description's `error`/`helperText`/`aria-invalid`.
  - `CreateConnectorEntityDialog.component.tsx`, `CreateColumnDefinitionDialog.component.tsx`, `EditConnectorInstanceDialog.component.tsx`, `CreateFieldMappingDialog.component.tsx`.
  - `modules/RegionEditor/NewEntityDialog.component.tsx`, `modules/RegionEditor/utils/region-editor-validation.util.ts` (`validateRegion`, `validateBindingDraft`), `modules/RegionEditor/RegionConfigurationPanel.component.tsx` (shows the label error).
  - `workflows/RestApiConnector/BasicsStep.component.tsx`.
  - **`PinResultDialog.component.tsx`:** today it maps *any* `NameSchema` failure to "Name is required" (`:61-66`). It now shows the schema's own message, or a too-long name would read "Name is required".
- Edit: `CLAUDE.md` → Form & Dialog Pattern → Zod Validation gains one bullet (name, description and key fields compose `nameField`/`descriptionField`/`keyField` from `@portalai/core/contracts`; no `maxLength` attribute). Mirror it in `.github/copilot-instructions.md`.
- Tests: the matching `apps/web/src/__tests__/*.test.tsx` and `modules/RegionEditor/__tests__/` files.

**Steps**
1. **Tests (spec cases 20–22, plus PinResultDialog).**
   - Paste or type over the limit, blur, then submit: the inline message, `aria-invalid="true"`, focus on the field, no `onSubmit`.
   - One case per dialog, the two validators, and PinResultDialog's too-long message.
   - Run; they fail.
2. **Implement** the schema swaps (keeping each existing pattern message), the description fields, the validator rules, the panel's error display, and the PinResultDialog message. Green.
3. Lint, type-check and format:check (web).

**Done when:** cases 20–22 pass, and the #801 repro (a 10,000-character New Station name) shows the inline error with no POST in a focused run.

**Risk:**
- **Wording changes:** the error copy in some dialogs changes (e.g. "Key must…" pattern messages are kept, but a long key now shows the limit first, because the max check runs before the regex). Assert the message per case.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `text-limits.contract.ts` + tests | core cases 1–6 |
| 2 | contract adoption + `name-length.guard` + replay regression | cases 7–12; touched web/api tests; root build |
| 3 | `sanitizeColumnName`, plan PATCH, provider names, `db:create-org`, tools + integration | cases 13–19 |
| 4 | web dialogs, RegionEditor, PinResultDialog, CLAUDE.md + Copilot mirror | cases 20–22 |

## Cross-slice notes

- **Builders over copies.** Every cap goes through `nameField`/`descriptionField`/`keyField`, never an inline `.max(120)`, so the guard, the API message and the web message all come from one place.
- **Optional wrappers.** Patch schemas keep `.optional()` on guarded fields. Only presence-required creates use the bare builder.
- **Core rebuild.** Web and API resolve `@portalai/core` from its `dist`. After slices 1 and 2, rebuild core before running web or API tests locally (memory: stale core dist).
- **Docs in sync.** Slice 4 carries the CLAUDE.md and Copilot mirror change. No Help, glossary or tool-description surface describes name lengths, so there's nothing else to update. The visualize tools' `title` cap is input validation, not a capability change to their descriptions.
- **Smoke and adversarial follow the slices.** `/smoke` maps the acceptance criteria. `/adversarial-review` should re-run the #789 §1.2 probe (10,000 characters) and probe trim, multibyte input at the boundary, and a long spreadsheet header through a full import.

## Next step

Implementation starts on `fix/801-name-length-limits` with slice 1, tests first, one commit per slice, once this plan is confirmed.
