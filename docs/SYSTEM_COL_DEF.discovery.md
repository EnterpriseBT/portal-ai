# System Column Definitions — Discovery & Recommendation

## Problem

The 26 column definitions seeded by `SeedService.seedSystemColumnDefinitions()` (invoked from `application.service.ts:84` on org provisioning) are indistinguishable from user-created ones. Users can currently edit or delete them through the UI, the REST API, and the AI tools, which leads to:

- Org-local drift from the shared catalog (a user renames `email` → re-seeding won't restore it because `upsertByKey` considers it an update target).
- Potential breakage of downstream `field_mappings` that point at the seeded row.
- No visual distinction in the list/detail UI between "built-in" fields and org-created fields.

## Recommendation

Add a non-nullable `system: boolean` column (default `false`) to `column_definitions`, set to `true` only for rows produced by the seeder. Enforce read-only semantics at every mutation boundary (REST, AI tools, UI), and surface the flag in the UI as a `system` vs. `custom` chip.

### Why a boolean column (vs. alternatives)

| Option | Trade-off |
|---|---|
| **Stored `system` flag (recommended)** | One-shot schema change; cheap to filter/serve; explicit in every API payload; easy to revoke per-org if we ever want "copy-to-custom." |
| Detect by `createdBy === SystemUtilities.id.system` | Implicit coupling to seed identity; breaks if we ever back-fill or re-author system rows; requires join/lookup to render in UI. |
| Detect by key-allow-list | Fragile — list lives in code, must be kept in sync with the seed array; doesn't survive custom deploys or future additions. |
| Separate `system_column_definitions` table | Splits a single logical catalog into two physical ones; every consumer (`field_mappings`, repositories, list endpoint) would need UNION logic. Not worth it. |

Naming: use `system` (not `isSystem`) — consistent with existing non-boolean fields on this table (`key`, `label`, `description`). `fieldMappings.isPrimaryKey` uses the `is*` prefix, but that's a legacy inconsistency we don't need to propagate.

---

## Implementation plan

### 1. Schema + model (dual-schema sync)

**`apps/api/src/db/schema/column-definitions.table.ts`**
```ts
system: boolean("system").notNull().default(false),
```

**`packages/core/src/models/column-definition.model.ts`** — `ColumnDefinitionSchema`:
```ts
system: z.boolean(),
```

The existing `type-checks.ts` assertions (`_ColDefDrizzleToModel`, `_ColDefModelToDrizzle`) will compile-fail until both sides land together, which is the intended guardrail.

### 2. Migration

`npm run db:generate -- --name add_system_flag_to_column_definitions`

The generated SQL should be:
```sql
ALTER TABLE "column_definitions"
  ADD COLUMN "system" boolean DEFAULT false NOT NULL;

-- Back-fill existing seeded rows. `SystemUtilities.id.system` is deterministic,
-- so filtering by createdBy is the safest selector on legacy data.
UPDATE "column_definitions"
SET "system" = true
WHERE "created_by" = '<SystemUtilities.id.system value>'
  AND "deleted" IS NULL;
```

Verify the `created_by` literal before applying; if the system-user id isn't stable across environments, use the seeded key-list as the selector instead.

### 3. Seeder

`SeedService.seedSystemColumnDefinitions` — pass `system: true` into `.update({...})` and include `system` in the `upsertByKey` `set` block in `column-definitions.repository.ts` so re-seeds don't silently flip a customised row back.

### 4. Contracts (`packages/core/src/contracts/column-definition.contract.ts`)

- `ColumnDefinitionCreateRequestBodySchema`: **omit `system`**. The router should always force `system: false` for user-initiated creates — per our "API handlers should not trust client-supplied authority fields" convention.
- `ColumnDefinitionUpdateRequestBodySchema`: **omit `system`**. It is immutable post-creation, just like `key`.
- `ColumnDefinitionSchema` (the read shape): includes `system`, so it appears on every GET response.

### 5. Router guardrails (`apps/api/src/routes/column-definition.router.ts`)

Add a single check after the existing `findById` lookup in both PATCH (`/:id`) and DELETE (`/:id`):
```ts
if (existing.system) {
  return next(new ApiError(
    422,
    ApiCode.COLUMN_DEFINITION_SYSTEM_READONLY,
    "System column definitions are read-only"
  ));
}
```

Add `COLUMN_DEFINITION_SYSTEM_READONLY` to `apps/api/src/constants/api-codes.constants.ts`.

On POST, hard-code `system: false` in the payload passed to the factory — do not read it from the request body.

### 6. AI tools

Same guard inside `ColumnDefinitionUpdateTool` and `ColumnDefinitionDeleteTool` phase-1 validation (after the `findById` that already populates `existingDefs`). Record a per-item failure like `{ index, error: "System column definition is read-only" }` so bulk calls report precise offenders rather than aborting.

`ColumnDefinitionCreateTool` also needs to force `system: false`.

### 7. UI

**`ColumnDefinitionCardUI`** (`apps/web/src/components/ColumnDefinition.component.tsx`)
- Add a chip in the `MetadataList` rendering `cd.system ? "System" : "Custom"` (e.g. `color="default"` for system, `color="primary"` for custom, both `variant="outlined"`).
- Compute `actions` as `[]` when `cd.system` — the Delete action should simply not appear.

**`ColumnDefinitionDetailView`** (`apps/web/src/views/ColumnDefinitionDetail.view.tsx`)
- `primaryAction`: render the Edit button with `disabled={cd.system}` and a tooltip "System column definitions cannot be edited". Don't hide it — users need to understand *why* they can't edit.
- `secondaryActions`: either omit the Delete entry entirely when `cd.system`, or pass `disabled: true` depending on the `PageHeader` API's support for disabled secondary actions (check before implementing — may require a small prop addition).
- Add the same System/Custom chip to the header's `MetadataList`.

**`ColumnDefinitionListView`** — no changes needed; it already routes delete clicks through the card, which will no longer surface the action for system rows.

**Field Mapping UI** — no change. System column definitions remain first-class targets for field mappings; only the definitions themselves are immutable.

### 8. List/filter affordance (optional, recommended)

Add a `system` filter to the list endpoint's query schema (`ColumnDefinitionListRequestQuerySchema`) and a toggle/filter chip in `ColumnDefinitionListView`'s `usePagination` config. Users frequently want to see "only my custom fields" — this is cheap to add and pairs naturally with the flag.

### 9. Tests

- Repository integration: round-trip `system: true` persists and is returned by `findByOrganizationId` / `findByKey`.
- Router integration: PATCH and DELETE on a system row → 422 with `COLUMN_DEFINITION_SYSTEM_READONLY`; POST ignoring a client-supplied `system: true` → persisted row has `system: false`.
- Seed integration: `seedSystemColumnDefinitions` writes `system: true`, and re-running does not flip a user's custom row to system.
- Tool tests: bulk update/delete with a mix of system and custom ids returns per-index failures for the system ones only.
- UI unit: `ColumnDefinitionCardUI` with `system: true` does not render the Delete action; `ColumnDefinitionDetailView` disables Edit/Delete.

### 10. Make column definitions read-only inside the `entity_management` tool pack

Independent of the `system` flag, the AI should not be able to create, update, or delete column definitions at all during a portal session. Separate from the per-row guard, **unregister the three column-definition tools from the `entity_management` pack**.

**`apps/api/src/services/tools.service.ts`** — in the `entity_management` block (≈ lines 252–270), remove these three registrations:
```ts
tools.column_definition_create = new ColumnDefinitionCreateTool().build(...);
tools.column_definition_update = new ColumnDefinitionUpdateTool().build(...);
tools.column_definition_delete = new ColumnDefinitionDeleteTool().build(...);
```

Also drop the three slugs from the `WRITE_TOOL_SLUGS` set at ≈ lines 116–118, and delete the three tool files plus their unit tests. Keep the underlying REST endpoints — the UI still needs them.

**`apps/api/src/prompts/system.prompt.ts`** — update the system prompt around line 117 so the model stops being told it can *"create one with column_definition_create"*. Replace with guidance that column definitions are managed outside the portal session and that unmapped source fields should surface as a warning to the user rather than trigger a schema change.

Rationale:

- **Safety.** Deleting or retyping a column definition cascades through `field_mappings` → `entity_records` and can silently corrupt normalised data across every connector instance that referenced it. Type transitions are already gated by `ALLOWED_TYPE_TRANSITIONS` and we block mutations while revalidation jobs run, but those guards don't protect against an AI deciding a column "should be" a different shape in the middle of a chat.
- **Rarity.** Column-definition authoring is an admin-level design decision, not a per-session action. With 26 system definitions covering the common shapes and a UI flow for adding custom ones, an end user in a portal should effectively never need one created mid-conversation.
- **Token / context cost.** Three tool schemas and their argument docs are loaded into every `entity_management` session today. Removing them trims the prompt, and — more importantly — removes a tempting path the model will sometimes take ("I'll just define a new column for this") that produces noisy, duplicative catalog entries that a human then has to clean up.
- **Defence in depth.** The per-row `system` guard from sections 5–6 still matters for the REST/UI surface. Removing the tools is an orthogonal, stronger constraint for the portal-session surface: *no* column definitions are writable via AI, not merely the system ones.

Residual capability the AI keeps:
- **Read** — `_column_definitions` remains in the synthetic-table list in the system prompt, so the model can still look up keys/types to inform field-mapping decisions.
- **Field mappings** — `field_mapping_create/update/delete` stay registered. Mapping a source field to an *existing* column definition is the safe, common operation; that's what the AI should be doing.

Tests to update/add:
- Remove `column-definition-create.tool.test.ts`, `column-definition-update.tool.test.ts`, `column-definition-delete.tool.test.ts`, and any references in `entity-management.integration.test.ts`.
- Add a `tools.service.test.ts` assertion that `entity_management` with `hasWrite: true` does **not** register `column_definition_*` tool slugs.

### 11. Rollout

This is a purely additive change:
- Migration is safe on a live table (`NOT NULL DEFAULT false` + single UPDATE).
- API remains backwards-compatible; existing clients that don't read `system` continue to work.
- No coordination with consumers of `field_mappings` or `entity_records` required.

Deploy order: migration → API → web. Re-running the seeder in any env after the API deploy will stamp legacy rows correctly via `upsertByKey`, so the backfill UPDATE in the migration is belt-and-braces rather than strictly required — but keep it, because the seeder only runs on org creation, not on every deploy.
