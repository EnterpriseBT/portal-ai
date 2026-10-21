# REST endpoints map existing column definitions — Condensed design (#838)

**Issue:** [EnterpriseBT/portal-ai#838](https://github.com/EnterpriseBT/portal-ai/issues/838) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Saving a REST endpoint (`POST /api/connector-instances/{id}/api-endpoints`) can create column definitions: a column with no adopted id and no readable definition with its key gets a fresh one. Since #834 that needs the column-definition create rule. The wizard doesn't know about the rule, so a caller without it walks to Commit and gets a 403 (#684 counts that as a bug), and two concurrent saves of one new key race (#839). A connector shouldn't add to the column-definition catalog at all. The catalog is managed on its own page, and an endpoint should only map onto it. **Endpoint save creates field mappings only, and every column names an existing, readable column definition.**

**Sizing override (recorded).** This touches core (a request contract), the API and the web app, which is normally the full path. It stays condensed because it's mostly removal: the wizard is the only caller of `columns`, and it adds no pattern. The review chain still runs code-review, security and smoke.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Column contract | `packages/core/src/contracts/api-connector.contract.ts:251` `CreateApiEndpointColumnDraftSchema` | `columnDefinitionId` nullable/optional; `type` is used only to create a definition |
| Resolve | `apps/api/src/routes/api-endpoints.router.ts:174` `resolveColumns` | adopted id → read check; else key match among readable; else create rule + `409 COLUMN_DEFINITION_KEY_CONFLICT` |
| Materialize | same file `:250` `materializeColumns` | creates fresh definitions, then mappings, then reconciles the wide table |
| Conflict code | `apps/api/src/constants/api-codes.constants.ts` `COLUMN_DEFINITION_KEY_CONFLICT` | used only here (#834) |
| Wizard rows | `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts:457` `ColumnRowDraft`, `:476` `validateColumnRows` | the id is null unless a suggestion was adopted or a definition picked |
| Step gate | `RestApiConnectorWorkflow.component.tsx:310–327` | row errors block step 2's Next and Enter |
| Commit body | same file `:666` | sends `type` and `columnDefinitionId ?? null` |
| Picker | `InferredColumnsTable.component.tsx` (`columnDefinitionId` column) | `AsyncSearchableSelect` over the readable catalog; takes `error` / `helperText` |

## Decision — every column picks an existing definition

- **Contract:** `columnDefinitionId: z.string().min(1)` (required), and `type` is dropped (the definition's type governs). A body without an id is a `400 REST_API_INVALID_CONFIG` naming the field.
- **API:**
  - `resolveColumns` becomes one read check over every column's id: in the org and readable, else `404 COLUMN_DEFINITION_NOT_FOUND`, before anything is written (#832/#834);
  - `materializeColumns` creates field mappings only, then reconciles;
  - `COLUMN_DEFINITION_KEY_CONFLICT` and the key-match and create branches are removed;
  - the OpenAPI text says the route maps onto existing definitions.
- **Web:**
  - `validateColumnRows` adds `row-<i>-columnDefinitionId`: "Pick a column definition" on any row without one;
  - the picker shows it (`error`, `helperText`, `aria-invalid`), and the step's Next and Enter stay blocked until each row has one;
  - an adopted suggestion fills it;
  - the commit body drops `type`, and `ColumnRowDraft` drops `type` too, since nothing renders it.
- A caller who can't read any fitting definition can't map that column here. They skip the row (remove it) or map it later on the connector page. No permission-specific copy is needed, since nobody creates here.
- **#839** is closed as superseded: no definition is created, so there's nothing to race.

## Plan — one slice

**Files**
- Edit: `packages/core/src/contracts/api-connector.contract.ts`: required id, no `type`; update the doc comments.
- Edit: `apps/api/src/routes/api-endpoints.router.ts`: resolve = read check; materialize = mappings only; update `@openapi`.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: remove `COLUMN_DEFINITION_KEY_CONFLICT`.
- Edit: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts`, `RestApiConnectorWorkflow.component.tsx` and `InferredColumnsTable.component.tsx`.

**Tests** (`npm run test:unit` / `npm run test:integration` per package)
- core `src/__tests__/contracts/api-connector.contract.test.ts`: a column without `columnDefinitionId` fails, and one with `type` fails (strict).
- api `src/__tests__/__integration__/routes/connector-column-definition-refs.integration.test.ts`:
  - the fresh-create and key-conflict cases become "no id → 400";
  - an owner's save with ids creates mappings and **no** column definition (the count is unchanged);
  - the unreadable / other-org / deleted → 404 cases stay.
- api `api-endpoints.router.integration.test.ts`: the #314 fresh-geometry case maps onto the seeded `geometry` definition.
- web `__tests__/rest-api-validation.util.test.ts`: a null id errs, an id passes, and a key error is reported alongside it (they're separate cells).
- web `__tests__/InferredColumnsTable.test.tsx`: the picker error renders with `aria-invalid="true"`.
- Next and Enter are blocked through the existing `canAdvance`, which reads these errors, so the validator tests cover it.

## Smoke (manual, against your dev stack)

1. As **owner**, run the REST wizard to the probe step. A row with an adopted suggestion shows no error. A row without one shows "Pick a column definition", and Next is disabled (Enter does nothing).
2. Pick a definition for each row (or remove the row) → Next works, and Commit → 201. The connector's entity has the mappings, and the column-definition count is unchanged.
3. `POST …/api-endpoints` with a column that has no `columnDefinitionId` → 400 naming `columns.0.columnDefinitionId`. Nothing is written.
4. As **member**, a save naming an owner-only definition → 404 `COLUMN_DEFINITION_NOT_FOUND`. One naming a system definition → 201.

## Out of scope

- Creating a column definition from inside the wizard (an inline "new definition" action). That would be a feature with its own create gate.
- Other connector flows (file upload and spreadsheets bind through layout plans, which never create definitions).
