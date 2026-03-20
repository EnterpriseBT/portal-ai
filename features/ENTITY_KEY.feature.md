# ENTITY_KEY Feature

## Editable Column Types in CSV Connector

### Overview

During/after the CSV connector confirmation process, users need the ability to edit column types recommended by the AI. The AI is usually correct but not always. For `reference` column types, `refEntityKey` and `refColumnDefinitionId` also need to be determinable by the user.

**Example scenario:**
- Upload `users.csv` and `roles.csv` → entities: `users`, `roles`
- `users` has a column `role_id` which the AI recommends as a reference to `roles.id`
- User may want to point that reference at `roles.tag` instead of `roles.id`
- User may also want to change a `number` column to `currency`

---

### Current State

- `ColumnMappingStep` renders `Type` as a **disabled** `TextInput` — no editing possible
- `RecommendedColumn.recommended` has no `refEntityKey` or `refColumnDefinitionId` fields
- `ConfirmColumnSchema` (`upload.contract.ts`) has no ref fields
- `uploads.service.ts` `resolveColumnDefinition()` always writes `refColumnDefinitionId: null`, `refEntityKey: null`

---

### Phase 1 — Core contract changes (`packages/core`)

#### Checklist
- [x] Add `refEntityKey`, `refColumnKey`, `refColumnDefinitionId` to `ConfirmColumnSchema` in `upload.contract.ts`
- [x] Update contract tests in `packages/core/src/__tests__/contracts/`
- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] `npm run build` passes

**`upload.contract.ts`** — extend `ConfirmColumnSchema`:

```ts
refEntityKey: z.string().nullable().optional(),
refColumnKey: z.string().nullable().optional(),         // for within-batch resolution
refColumnDefinitionId: z.string().nullable().optional(), // for existing DB column
```

`refColumnKey` is needed for same-batch references (e.g., `users.role_id → roles.id`), since the referenced column doesn't have a DB ID yet at confirm time. The API resolves it post-creation.

---

### Phase 2 — Frontend util (`upload-workflow.util.ts`)

#### Checklist
- [x] Add `refEntityKey`, `refColumnKey`, `refColumnDefinitionId` to `RecommendedColumn.recommended`
- [x] Update `mapBackendRecommendations()` to carry over ref fields
- [x] Update `confirm()` to include ref fields in request body
- [x] Update/add tests in `__tests__/upload-workflow.test.ts`
- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] `npm run build` passes

**`RecommendedColumn.recommended`** — add ref fields:

```ts
refEntityKey?: string | null;
refColumnKey?: string | null;
refColumnDefinitionId?: string | null;
```

- **`mapBackendRecommendations()`** — carry over ref fields if the AI recommendation includes them
- **`confirm()`** — include the three ref fields in the request body per column

---

### Phase 3 — `ColumnMappingStep` UI

#### Checklist
- [x] Replace disabled `Type` `TextInput` with an editable `Select` in `ColumnRow`
- [x] Clear ref fields on type change away from `reference`
- [x] Add `ReferenceEditor` sub-component (entity select + dependent column select)
- [x] Pass `allEntities` prop through `ColumnMappingStep` → `ColumnRow`
- [x] Add inline `enumValues` editor when `type === "enum"`
- [x] Update/add tests in `__tests__/ColumnMappingStep.test.tsx`
- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] `npm run build` passes

The `ColumnRow` sub-component gets the most significant changes:

1. **Type field**: Replace the disabled `TextInput` with an enabled `Select` using `ColumnDataTypeEnum` values as options. On change, clear ref fields if switching away from `reference`.

2. **Reference editor** (rendered only when `type === "reference"`): A `ReferenceEditor` sub-component with two dependent selects:
   - **Entity select** — options come from `recommendations.entities` (the batch). Changing this resets column selection. Sets `refEntityKey`.
   - **Column select** — options are the columns of the selected entity from `recommendations.entities`. Sets `refColumnKey`. Displays as `label (key)`.

3. **`ColumnRow` now also receives `allEntities: RecommendedEntity[]`** so the reference editor can build its options. This prop flows from `ColumnMappingStep` which already has `entities`.

4. **Inline `enumValues` editor**: simple comma-separated text input shown when `type === "enum"`.

---

### Phase 4 — API service (`apps/api/src/services/uploads.service.ts`)

#### Checklist
- [x] Read `refEntityKey`, `refColumnKey`, `refColumnDefinitionId` from confirm request body
- [x] Pass ref fields through to `resolveColumnDefinition()`
- [x] Implement second pass: resolve `refColumnKey` → `refColumnDefinitionId` from cache after first pass
- [x] Handle `refColumnDefinitionId` passed directly (pre-existing DB column)
- [x] Update/add tests in `__tests__/services/uploads.service.test.ts`
- [x] Update/add integration tests in `__tests__/__integration__/routes/uploads.router.integration.test.ts`
- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] `npm run build` passes

`resolveColumnDefinition()` currently always sets `refColumnDefinitionId: null`. Changes needed:

**Two-pass approach inside `confirm()`:**

1. **First pass** (existing): create/resolve all column definitions. The `cache` map already tracks `orgId:key → { id, key, label }` for all created columns.

2. **Second pass** (new): after all entities are processed, iterate every column with `type === "reference"`. If `refColumnKey` is provided, look it up in the cache to get its ID, then `UPDATE column_definitions SET ref_column_definition_id = <id>, ref_entity_key = <refEntityKey>` for that column. If `refColumnDefinitionId` is provided directly (reference to a pre-existing DB column), use it as-is.

This is safe because:
- All batch columns are created in pass 1 (and cached)
- Pass 2 resolves references from that cache — no ordering dependency
- Existing DB columns are already known and can be passed through directly

---

### Phase 5 — `ReviewStep` display

#### Checklist
- [x] Show ref target in column list (e.g., `reference → roles.id`)
- [x] Update/add tests in `__tests__/ReviewStep.test.tsx`
- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test` passes
- [x] `npm run build` passes

Extend the per-column row in `ReviewForm` to show reference details:

```
role_id → role_id (reference → roles.id)
```

---

### File Change Summary

| File | Change |
|------|--------|
| `packages/core/src/contracts/upload.contract.ts` | Add `refEntityKey`, `refColumnKey`, `refColumnDefinitionId` to `ConfirmColumnSchema` |
| `apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts` | Add ref fields to `RecommendedColumn.recommended`; update `mapBackendRecommendations` and `confirm()` |
| `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx` | Replace disabled type input with `Select`; add `ReferenceEditor` sub-component; pass `allEntities` to `ColumnRow` |
| `apps/web/src/workflows/CSVConnector/ReviewStep.component.tsx` | Show ref target in column list |
| `apps/api/src/services/uploads.service.ts` | Two-pass ref resolution in `confirm()`; read ref fields from body |

---

### Phase 6 — Reference picker for existing DB entities

Allow users to reference column definitions that already exist in the database, not just entities in the current upload batch.

#### Checklist
- [ ] Add API endpoint or reuse `GET /api/column-definitions` to search existing column definitions by entity key
- [ ] Extend `ReferenceEditor` entity select to include existing DB entities alongside batch entities
- [ ] Fetch column definitions for a selected existing entity (lazy, on entity select change)
- [ ] Populate column select from fetched results; set `refColumnDefinitionId` directly (skip `refColumnKey`)
- [ ] Handle loading/error states in the reference editor
- [ ] Update/add tests in `__tests__/ColumnMappingStep.test.tsx`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

---

### Phase 7 — `format` editing

Allow users to edit the `format` field for column types that support it (`date`, `datetime`, `string`).

#### Checklist
- [ ] Show a `format` `TextInput` in `ColumnRow` when `type` is `date`, `datetime`, or `string`
- [ ] Pre-populate with AI-recommended value (e.g., `YYYY-MM-DD`, `ISO8601`, `email`)
- [ ] Clear `format` when type changes to a type that doesn't support it
- [ ] Update/add tests in `__tests__/ColumnMappingStep.test.tsx`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes
