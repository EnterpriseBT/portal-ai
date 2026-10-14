# Length limits on user-authored text — Spec

**Issue:** [EnterpriseBT/portal-ai#801](https://github.com/EnterpriseBT/portal-ai/issues/801) · **Discovery:** `docs/NAME_LENGTH_LIMITS.discovery.md` · **PR:** #803

Pins one set of text limits in `@portalai/core`. Every request contract that carries a user-authored name, label, title, description or key composes them, and the API's non-contract write sites, the agent tools and every web form that edits these fields apply them too. A core guard keeps new contracts from regressing. Separately, `sanitizeColumnName` gains a hard 63-byte guarantee, so no key, however long, can produce a Postgres identifier that gets silently truncated.

## Key decisions (flag for review)

Discovery D1–D4 and Q1–Q5 apply as leaned. Two refinements surfaced while pinning signatures:

1. **The layout plan schema stays uncapped.**
   - `LayoutPlanSchema` is re-parsed on every replay (`spreadsheet-parsing/src/replay/index.ts:32`) and by interpret's own output (`interpret/index.ts:57`).
   - Anchor-cell axis names and header locators are spreadsheet text, not user input.
   - A cap there would break syncs of stored plans and fail interprets of sheets with long headers.
   - Instead, the two request paths that put user-edited plan text into objects check it with `planTextLimitIssues` (below). Those are the commit-draft contract and the plan PATCH. The plan subtree is exempt from the guard, with that reason recorded.
2. **Two parts to the identifier fix.**
   - User-authored `normalizedKey`s are capped at 58 by contract.
   - `sanitizeColumnName` clips so its output is always ≤ 63 bytes. This covers keys derived from long spreadsheet headers, which no contract sees.
   - Curated-view keys keep their existing `max(63)`: a temp-view name has no prefix.
3. **Names are trimmed everywhere.** Adding `trim()` to station, tag, group, column definition, connector entity, connector instance, API endpoint, curated view and pin create means a whitespace-only name becomes "Name is required" (it was accepted). Descriptions are not trimmed, because their text is the user's.
4. **No migration and no backfill.** Existing over-length rows are untouched. A PATCH that resends one is a 400 until it's shortened (Q1).

## Scope

### In scope
- Core: the limits module; every request contract's guarded fields; `planTextLimitIssues`; the guard test.
- API:
  - `sanitizeColumnName`'s byte guarantee
  - the plan PATCH check
  - provider-derived connector names (clipped)
  - `db:create-org` name (rejected)
  - agent tools with local Zod
- Web: every local dialog schema that edits a guarded field; Create/Edit Station and TagFormModal `description`; the RegionEditor region label and binding key checks.

### Out of scope
- Strings that aren't labels: SQL, transform code, URLs, filter JSON, body templates, chat `message`, interpret `notes`. These belong to a follow-up every-string guard.
- `PageHeader`/breadcrumb display truncation.
- DB constraints.
- Repairing existing over-length rows.
- Columns Postgres already created truncated: their catalog names already mismatch. That's a separate repair if any exist.
- `normalizedKey` used as a SQL alias in portal SQL (`portal-sql.service.ts:625`): the contract cap bounds new keys, and existing long keys are the same separate repair.

## Surface

### Core: `packages/core/src/contracts/text-limits.contract.ts` (new, re-exported from `contracts/index.ts`)

```ts
import { z } from "zod";

/** Names, labels and titles (#801). */
export const NAME_MAX_LENGTH = 120;
/** Descriptions and validation messages (matches promptHint's existing 2000). */
export const DESCRIPTION_MAX_LENGTH = 2000;
/** Keys that become `c_<key>` Postgres identifiers: 63 − "c_" − "_NN". */
export const KEY_MAX_LENGTH = 58;
/** Postgres's identifier limit (NAMEDATALEN − 1), in bytes. */
export const PG_IDENTIFIER_MAX_BYTES = 63;

export const tooLongMessage = (field: string, max: number): string =>
  `${field} must be ${max} characters or fewer`;

/** Trimmed, required, ≤ NAME_MAX_LENGTH. */
export const nameField = (field = "Name") =>
  z.string().trim()
    .min(1, `${field} is required`)
    .max(NAME_MAX_LENGTH, tooLongMessage(field, NAME_MAX_LENGTH));

/** Untrimmed, ≤ DESCRIPTION_MAX_LENGTH. Callers add .optional()/.nullable(). */
export const descriptionField = (field = "Description") =>
  z.string().max(DESCRIPTION_MAX_LENGTH, tooLongMessage(field, DESCRIPTION_MAX_LENGTH));

/** ≤ KEY_MAX_LENGTH. Callers compose their pattern (.regex) after it. */
export const keyField = (field = "Key") =>
  z.string().max(KEY_MAX_LENGTH, tooLongMessage(field, KEY_MAX_LENGTH));

/** For names we generate (provider account labels): clip, never reject. */
export const clipToLength = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;
```

### Core: contract adoption

`.optional()`/`.nullable()` wrappers and every other field stay as they are.

| Contract (file:line) | Field → rule |
|---|---|
| `CreateStationBodySchema` (`station.contract.ts:119-120`) / `UpdateStationBodySchema` (`:172-173`) | `name: nameField()` (`.optional()` on update), `description: descriptionField().optional()` |
| `UpdatePortalBodySchema` (`portal.contract.ts:134`), `UpdatePortalResultBodySchema` (`:148`), `PinResultBodySchema` (`:211`) | `name: nameField()` (`.optional()` on portal) |
| `EntityTagCreate/UpdateRequestBodySchema` (`entity-tag.contract.ts:57-59`, `:80-82`) | `name: nameField()`, `description: descriptionField().optional()` |
| `EntityGroupCreate/UpdateRequestBodySchema` (`entity-group.contract.ts:77-78`, `:99-100`) | same |
| `ColumnDefinitionCreateRequestBodySchema` (`column-definition.contract.ts:52-57`) | `key: keyField().regex(/^[a-z][a-z0-9_]*$/)`, `label: nameField("Label")`, `description`/`validationMessage: descriptionField(...)…` |
| `ColumnDefinitionUpdateRequestBodySchema` (`:80-85`) | `label`, `description`, `validationMessage` as above |
| `ConnectorEntityCreateRequestBodySchema` (`connector-entity.contract.ts:106-107`) / `…PatchRequestBodySchema` (`:128`) | `key: keyField().regex(…)`, `label: nameField("Label")` |
| `ConnectorInstanceCreateRequestBodySchema` (`connector-instance.contract.ts:126`) / `…PatchRequestBodySchema` (`:163`) | `name: nameField()` |
| `LayoutPlanCommitDraftRequestBodySchema` (`connector-instance-layout-plans.contract.ts:221`) | `name: nameField()`; plus `.superRefine` adding `planTextLimitIssues(plan)` |
| `CreateApiEndpointRequestBodySchema` / `PatchApiEndpointRequestBodySchema` (`api-connector.contract.ts:264-265`, `:285`) | `key: keyField().min(1)`, `label: nameField("Label")` |
| `RegisterToolpackBodySchema` / `UpdateToolpackBodySchema` (`toolpack.contract.ts:135`, `:146`) | `description: descriptionField().min(1)…` (`name` stays slug-regex bounded) |
| `PolicyUpsertRequestSchema` / `RoleUpsertRequestSchema` / `GroupUpsertRequestSchema` (`rbac-authoring.contract.ts:38-39`, `:71`, `:104-105`) | `name: nameField()`, `description: descriptionField().nullable().optional()` |
| `CuratedViewCreate/UpdateRequestBodySchema` (`curated-view.contract.ts:117-118`, `:143-144`) | `label: nameField("Label")`, `description: descriptionField().nullable().optional()` |
| `normalizedKeyBase` (`field-mapping.contract.ts:102`) | `keyField("Normalized key").regex(…).refine(…)` |

### Core: `planTextLimitIssues` (in `text-limits.contract.ts`)

```ts
/** The user-authored text in a layout plan that becomes object fields (#801):
 *  a new entity's label (`regions[i].targetEntityDefinitionId`, ≤ NAME) and
 *  binding `normalizedKey` overrides (≤ KEY). Returns Zod-shaped issues so a
 *  contract's superRefine and the PATCH service report them the same way.
 *  Never applied to LayoutPlanSchema itself (replay re-parses stored plans). */
export function planTextLimitIssues(
  plan: LayoutPlan
): Array<{ path: (string | number)[]; message: string }>;
```

The paths are relative to the plan (`["regions", 2, "targetEntityDefinitionId"]`). The contract prefixes them with `"plan"`.

### Core: `name-length.guard.test.ts` (new, `packages/core/src/__tests__/contracts/`)

- **Enumeration:** the same as `strict-request-bodies.test.ts:31-38`.
- **Walk:** recursively through object shapes, optional/nullable/default wrappers, arrays, pipes and effects.
- **Guarded field names:** `name`, `label`, `title`, `description`, `notes`, `key`, `normalizedKey`, `axisName`, `validationMessage`, `proposedLabel`, `displayName`.
- **Failure:** a guarded field whose `ZodString` has no `max_length` check fails as `"<Schema>.<path>"`.
- **`EXEMPT: Record<string, string>`**, keyed by schema or `Schema.path`, each with a reason:
  - `LayoutPlanCommitDraftRequestBodySchema.plan` — stored plans replay; spreadsheet text; checked by `planTextLimitIssues`
  - `InterpretRequestBodySchema` — prompt hints, never stored as labels
  - `RegisterToolpackBodySchema.name` / `UpdateToolpackBodySchema.name` — slug regex caps at 63
- **Sanity:** at least 30 guarded fields matched, and every `EXEMPT` key still resolves.

### API

- **`sanitizeColumnName`** (`apps/api/src/services/wide-table-reconciler.service.ts:118-134`):
  - clips `stripped` so `c_<stripped>` ≤ 63 bytes;
  - when a `_N` suffix is needed, clips further so the candidate stays ≤ 63;
  - returns the same result as today for every key whose candidate already fits.
- **Plan PATCH** (`connector-instance-layout-plans.service.ts:216`): after the merged plan parses, `planTextLimitIssues(merged)` non-empty → the same 400 path as the parse failure, with the issues.
- **Provider names:**
  - `` `Google Sheets (${email})` `` (`google-sheets-connector.service.ts:~161`) and `` `Microsoft 365 Excel (${profile.upn})` `` (`microsoft-excel-connector.service.ts:202`) go through `clipToLength(…, NAME_MAX_LENGTH)`.
  - The workbook and sheet titles used for entity labels (`microsoft-excel-connector.service.ts:354`, `:363`) are clipped the same way.
- **`db:create-org`** (`apps/api/src/db/create-org.ts:18-26`): a `--name` over `NAME_MAX_LENGTH`, or blank after trim, throws the usage error naming the limit.
- **Agent tools:**
  - `connector-entity-create.tool.ts:16-25`: `key: keyField().regex(/^[a-z][a-z0-9_]*$/)` (gaining the contract's pattern), `label: nameField("Label")`.
  - `connector-entity-update.tool.ts:13-15`: `label: nameField("Label")`.
  - `field-mapping-create.tool.ts:31-41` / `field-mapping-update.tool.ts:25-36`: `normalizedKey` composes `keyField("Normalized key")`.
  - `visualize-d3.tool.ts:27`, `visualize-map.tool.ts:38`: `title: z.string().max(NAME_MAX_LENGTH, tooLongMessage("Title", NAME_MAX_LENGTH)).optional()`.
  - RBAC tools inherit from their contracts.
- **No new `ApiCode`.** Each route's existing `<DOMAIN>_INVALID_PAYLOAD` carries the message, e.g. `"Invalid station payload: name: Name must be 120 characters or fewer"`.

### Web (`apps/web`)

- **Local dialog schemas compose the core builders.**
  - Each `name`/`label` rule becomes `nameField(...)`.
  - Each `key`/`normalizedKey` rule becomes `keyField(...).regex(<existing pattern, existing message>)`.
  - Files:
    - `CreateStationDialog` `StationFormSchema` (`:48-51`)
    - `EditStationDialog` `EditStationFormSchema` (`:75-78`)
    - `TagFormModal` `TagFormSchema` (`:37`)
    - `CreateConnectorEntityDialog` `EntityFormSchema` (`:28`)
    - `CreateColumnDefinitionDialog` (`:39`)
    - `EditConnectorInstanceDialog` `EditNameSchema` (`:17`)
    - `CreateFieldMappingDialog` (`:24`)
    - `RegionEditor/NewEntityDialog` `buildSchema` (`:48`)
    - `RestApiConnector/BasicsStep`'s name rule
- **Descriptions are validated:** Create/Edit Station and TagFormModal add `description: descriptionField()`. Their description field gets the standard `error`/`helperText`/`aria-invalid` triple.
- **RegionEditor:**
  - `validateRegion` (`modules/RegionEditor/utils/region-editor-validation.util.ts:62`) adds `proposedLabel` / new-entity label > `NAME_MAX_LENGTH` → the `tooLongMessage("Label", …)` error, shown on the RegionConfigurationPanel label field (`:780`).
  - `validateBindingDraft` (`:252`) adds `normalizedKey` > `KEY_MAX_LENGTH`.
- **No `maxLength` attribute anywhere.** Errors show after blur or submit and focus the field, per the Form & Dialog Pattern.
- **Already covered through the contract:** the dialogs that validate with the contract directly (pin and portal rename, pin, toolpacks, entity groups, column definition edit, connector entity edit, curated view editor, RBAC `NameField`) need no code change.

## Migration / Seed

None. No schema change, no seeded rows, no data repair.

## TDD test plan

Run with `cd packages/core && npm run test:unit`, `cd packages/spreadsheet-parsing && npm run test:unit` (the replay regression), `cd apps/api && npm run test:unit && npm run test:integration`, and `cd apps/web && npm run test:unit`. Only touched files locally; CI runs the suites.

### Core: `__tests__/contracts/text-limits.contract.test.ts` (new)
1. `nameField` accepts exactly 120 characters and rejects 121 with "Name must be 120 characters or fewer".
2. `nameField` trims; whitespace-only fails with "Name is required"; a custom field label appears in both messages.
3. `descriptionField` accepts 2000, rejects 2001, and doesn't trim.
4. `keyField` accepts 58 and rejects 59.
5. `clipToLength` leaves short values alone and clips to exactly `max` with a trailing `…`.
6. `planTextLimitIssues` reports an over-length `targetEntityDefinitionId` and an over-length binding `normalizedKey` at their plan paths, and returns `[]` for a plan within limits.

### Core: contract cases (extend each contract's existing test file)
7. Each adopted contract in the table rejects an over-length guarded field and accepts the boundary value: one case per schema family (station, portal/pin, tag, group, column definition, connector entity, connector instance, API endpoint, toolpack description, RBAC ×3, curated view, field mapping), about 15.
8. `LayoutPlanCommitDraftRequestBodySchema` rejects an over-length new-entity label with path `plan.regions.0.targetEntityDefinitionId`.

### Core: `name-length.guard.test.ts` (new)
9. No guarded field is left unbounded (the real tree passes).
10. The walker flags a fixture schema with an unbounded `name` nested in an optional array of objects.
11. Every `EXEMPT` key resolves, and the minimum match count holds.

### Parser regression (`packages/spreadsheet-parsing`)
12. `replay` of a stored plan whose axis name is 500 characters still parses (pins Key decision 1).

### API
13. `sanitizeColumnName` unit test: a 200-character key yields ≤ 63 bytes. Two long keys sharing a 70-character prefix yield distinct names. With `taken` holding the base through `_120`, the result is still ≤ 63 bytes. A short key's output is unchanged.
14. Integration: `POST /api/stations` with a 121-character name → 400 `STATION_INVALID_PAYLOAD` whose message names the limit, and no row is written. 120 characters → 201.
15. Integration: `PATCH /api/stations/:id` resending an existing over-length name → 400 (Q1). The same PATCH without `name` → 200.
16. Integration: plan PATCH with an over-length binding `normalizedKey` override → 400, and the stored plan is unchanged.
17. Integration: commit-draft with an over-length new-entity label → 400, and no instance is created.
18. Unit: the Google and Excel instance-name builders clip a 300-character account label to 120 characters ending in `…`.
19. Unit: the `connector-entity-create` tool rejects a 59-character key and a key that breaks the pattern. The `visualize-d3` tool rejects a 121-character title.

### Web
20. `CreateStationDialog`: pasting 121 characters into Name → blur shows "Name must be 120 characters or fewer", sets `aria-invalid="true"`, and Create doesn't call `onSubmit`. A 2,001-character Description shows its error the same way.
21. `EditStationDialog`, `TagFormModal`, `CreateConnectorEntityDialog` (label and key), `CreateColumnDefinitionDialog` (key), `EditConnectorInstanceDialog`, `CreateFieldMappingDialog` (normalizedKey), `NewEntityDialog`: one over-length case each.
22. `validateRegion` reports an over-length region label; `validateBindingDraft` reports a 59-character key.

**Totals ≈ 50 cases** (6 + ~16 + 3 core, 1 parser, 7 API, ~10 web, plus the two RegionEditor validators).

## Acceptance criteria

- [ ] The #801 repro: a 10,000-character New Station name shows "Name must be 120 characters or fewer" inline, focuses Name, and sends nothing. The same request through the API is a 400 naming the field.
- [ ] Every request contract's names and labels (≤ 120), descriptions (≤ 2000) and user keys (≤ 58) are capped. `name-length.guard.test.ts` fails CI on a new unbounded one.
- [ ] Every web form that edits those fields shows the limit inline. No field silently truncates input.
- [ ] Agent tools that create entities, field mappings or visualizations reject over-length values with a typed tool error.
- [ ] `sanitizeColumnName` never returns more than 63 bytes, and two long keys can't collide.
- [ ] Stored layout plans with long spreadsheet-derived text still replay and sync.
- [ ] Existing over-length rows still read and render. Only a write that sends an over-length value is refused.
- [ ] `npm run lint`, `npm run type-check`, `npm run build` and `format:check` are clean.

## Risks & rollback

| Risk | Detection / mitigation |
|---|---|
| A cap lands on a schema that parses stored data (models, `LayoutPlanSchema`), turning reads or replays into 500s | Caps live only in request contracts; test 12 pins replay; the guard walks request bodies only |
| `trim()` on names changes behavior for callers sending padded names | Intended. Padded names are stored trimmed; whitespace-only becomes a 400 like it already is on portal and pin |
| A route or tool writes a guarded field without a contract | Discovery inventoried them (provider names, `db:create-org`, commit labels); each has a test (17, 18, the CLI case is manual) |
| A client outside the web sends a long name and starts getting 400s | Fail closed by design (a 400 naming the field). No external API consumers exist |
| `sanitizeColumnName` clipping renames an existing column | It only changes outputs for keys whose column already exceeded 63 bytes (truncated by Postgres, so already broken); test 13 pins unchanged output for short keys |

**Rollback:** `git revert`. There's no migration or data change, so reverting restores the unbounded behavior exactly.

## Files touched

- **`packages/core`:**
  - new: `contracts/text-limits.contract.ts`, `__tests__/contracts/text-limits.contract.test.ts`, `__tests__/contracts/name-length.guard.test.ts`
  - edit: `contracts/index.ts` and the contracts in the adoption table (station, portal, entity-tag, entity-group, column-definition, connector-entity, connector-instance, connector-instance-layout-plans, api-connector, toolpack, rbac-authoring, curated-view, field-mapping), plus their contract tests
- **`packages/spreadsheet-parsing`:** test only (replay regression)
- **`apps/api`:**
  - edit: `services/wide-table-reconciler.service.ts`, `services/connector-instance-layout-plans.service.ts`, `services/google-sheets-connector.service.ts`, `services/microsoft-excel-connector.service.ts`, `db/create-org.ts`, `tools/connector-entity-create.tool.ts`, `tools/connector-entity-update.tool.ts`, `tools/field-mapping-create.tool.ts`, `tools/field-mapping-update.tool.ts`, `tools/visualize-d3.tool.ts`, `tools/visualize-map.tool.ts`
  - their unit and integration tests
- **`apps/web`:**
  - edit: `components/CreateStationDialog`, `EditStationDialog`, `TagFormModal`, `CreateConnectorEntityDialog`, `CreateColumnDefinitionDialog`, `EditConnectorInstanceDialog`, `CreateFieldMappingDialog` (`.component.tsx`), `modules/RegionEditor/NewEntityDialog.component.tsx`, `modules/RegionEditor/RegionConfigurationPanel.component.tsx`, `modules/RegionEditor/utils/region-editor-validation.util.ts`, `workflows/RestApiConnector/BasicsStep.component.tsx`
  - their tests
- **Docs:** `record-field-serialization.util.ts` is unaffected (record values, not labels). There's no Help or glossary change. `CLAUDE.md` → Form & Dialog Pattern gains one line: name, description and key fields compose `nameField`/`descriptionField`/`keyField` (mirrored in `.github/copilot-instructions.md`).

## Implementation notes (where the build departed from this spec)

- **Guard findings.** `CreateApiEndpointColumnDraftSchema.normalizedKey` (REST API endpoint column drafts) is capped too: the guard found it, and the inventory above had missed it. `LayoutPlanInterpretDraftRequestBodySchema` joins `EXEMPT` (interpret hints plus a prior stored plan, the same case as `InterpretRequestBodySchema`).
- **Plan PATCH** checks `planTextLimitIssues` only when the body sends `regions`, so a plan stored before the limits can still have its other fields patched.
- **Excel workbook and sheet titles** (`microsoft-excel-connector.service.ts:354`, `:363`) are unchanged. They go into the instance config and the workflow's display, not into an entity label; entity labels come from the plan.
- **`builtin-toolpacks.ts`** needs no change. Its parameter mirror carries descriptions only, with no limits or patterns for any tool.
- **RegionEditor.** The panel's "Label" field (`proposedLabel`) is an interpret hint, exempt like the interpret schemas, and isn't capped. `validateRegion` checks `targetEntityDefinitionId` instead, which commit turns into the entity label, and `NewEntityDialog` caps the label and key the user types.
- **Also capped in the web:** the REST API connector's `validateEndpoint` (key, label) and `validateColumnRows` (normalizedKey). `EditStationDialog` has no description field, so it caps the name only.
- **Code-review fixes** (after slice 4):
  - A plan region's `targetEntityDefinitionId` is held to `KEY_MAX_LENGTH` (58), not the name limit: commit makes it both the entity's key and its label.
  - `planTextLimitIssues` also runs when a stored plan is committed by id (`LayoutPlanDraftService.prepareRecommit`), since interpret stores region hints as given.
  - Keys derived from long headers are clipped in `sourceFieldToNormalizedKey`. The parser package keeps its own `DERIVED_KEY_MAX_LENGTH`, pinned equal to core's by a test.
  - Connector names the web builds from a file name or a sheet/workbook title go through `generatedConnectorName` (`apps/web/src/utils/connector-instance-name.util.ts`).
  - Edit Field Mapping resends `normalizedKey` only when it changed.
  - `clipToLength` never splits a character, and its result stays within `max` UTF-16 units, so within the `max` code points that Zod's `.max()` counts. (The adversarial walk showed Zod measures code points, not units, so "characters" in the messages is accurate.)
  - `sanitizeColumnName` also avoids names Postgres truncated before the clip.
  - The GIST index name truncation the review found is #804.
- **Contract cases** (test plan 7–8) live in one table-driven file, `packages/core/src/__tests__/contracts/text-limits.adoption.test.ts`, not in each contract's own test file.

## Next step

`docs/NAME_LENGTH_LIMITS.plan.md` sequences this into about 4 TDD slices on this branch:
1. the core limits module, `planTextLimitIssues` and the guard, written red;
2. contract adoption, which turns the guard green, with contract tests and the replay regression;
3. the API: `sanitizeColumnName`, plan PATCH, provider names, `db:create-org`, the agent tools, and the integration tests;
4. the web forms and RegionEditor validators.
