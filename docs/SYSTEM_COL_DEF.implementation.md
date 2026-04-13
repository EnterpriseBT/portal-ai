# System Column Definitions — TDD Implementation Plan

Companion to [`SYSTEM_COL_DEF.discovery.md`](./SYSTEM_COL_DEF.discovery.md). Each phase is red → green → refactor. Do not move to the next phase until the current one's full test file is green; run the touched test file between red and green so you see the failure you expect.

Prefix commands assume the repo root. API tests run from `apps/api/`, core from `packages/core/`, web from `apps/web/`.

---

## Phase 0 — Branch + baseline

1. Branch is already `feat/column-def-read-only` — confirm with `git status`.
2. Baseline green: `npm run type-check && npm run test` at the monorepo root. Fix any unrelated failures before starting so later red states are unambiguous.

---

## Phase 1 — Core schema: `system` field

Goal: the Zod model and Drizzle table both carry `system: boolean`, and the compile-time assertions in `type-checks.ts` align. No behaviour change yet.

### 1a. RED — model test

**File:** `packages/core/src/__tests__/models/column-definition.model.test.ts`

Add (or extend) a test that parses a minimal valid object and asserts `system` is a required boolean:

```ts
it("requires a boolean `system` field", () => {
  const base = { /* existing minimal fixture */, system: false };
  expect(ColumnDefinitionSchema.safeParse(base).success).toBe(true);

  const missing = { ...base } as Record<string, unknown>;
  delete missing.system;
  expect(ColumnDefinitionSchema.safeParse(missing).success).toBe(false);

  const wrong = { ...base, system: "yes" };
  expect(ColumnDefinitionSchema.safeParse(wrong).success).toBe(false);
});
```

Run `npm run test -- column-definition.model` from `packages/core/` — should fail.

### 1b. GREEN — model + drizzle + type-checks

1. **`packages/core/src/models/column-definition.model.ts`** — add `system: z.boolean()` to `ColumnDefinitionSchema` (place after `canonicalFormat`).
2. **`apps/api/src/db/schema/column-definitions.table.ts`** — add `system: boolean("system").notNull().default(false),` (import `boolean` from `drizzle-orm/pg-core`).
3. **`apps/api/src/db/schema/type-checks.ts`** — no edit needed; the existing `_ColDefDrizzleToModel` / `_ColDefModelToDrizzle` / `_ColDefInferredToModel` assertions now verify the new field on both sides. If only one of steps 1 or 2 is applied, `npm run type-check` from `apps/api/` will fail here — that is the intended safety net. Apply both.

Green check: `npm run test -- column-definition.model` (core) and `npm run type-check` (root) both pass.

### 1c. Migration

From `apps/api/`:

```bash
npm run db:generate -- --name add_system_flag_to_column_definitions
```

Open the generated `apps/api/drizzle/XXXX_add_system_flag_to_column_definitions.sql` and append the backfill after the generated `ADD COLUMN`:

```sql
UPDATE "column_definitions"
SET "system" = true
WHERE "created_by" = '<SystemUtilities.id.system value>'
  AND "deleted" IS NULL;
```

Verify the literal for `SystemUtilities.id.system` by opening `apps/api/src/utils/system.util.ts`. If that id is ephemeral across envs, substitute a key-list:

```sql
UPDATE "column_definitions"
SET "system" = true
WHERE "key" IN ('uuid','string_id','number_id','email','phone','url','name','description','text','code','address','status','tag','integer','decimal','percentage','currency','quantity','boolean','date','datetime','enum','json_data','array','reference','reference_array')
  AND "deleted" IS NULL;
```

Apply locally: `npm run db:migrate`.

### 1d. REFACTOR

None expected.

---

## Phase 2 — Seeder + repository persist the flag

Goal: newly seeded rows write `system: true`; re-seeding does not overwrite a user-modified row back to system status.

### 2a. RED — unit + integration

**File:** `apps/api/src/__tests__/services/seed.service.test.ts`

Add assertion inside `describe("SeedService.seedSystemColumnDefinitions")`:

```ts
it("marks every seeded row with system: true", async () => {
  await seedService.seedSystemColumnDefinitions("org-123", fakeDb);
  const calls = mockUpsertByKey.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  for (const [arg] of calls) {
    expect(arg.system).toBe(true);
  }
});
```

**File:** `apps/api/src/__tests__/__integration__/services/seed.service.integration.test.ts`

Add:

```ts
it("persists system: true for every seeded definition", async () => {
  await seedService.seedSystemColumnDefinitions(organizationId, db);
  const rows = await columnDefsRepo.findByOrganizationId(organizationId, db);
  expect(rows.every((r) => r.system === true)).toBe(true);
});
```

**File:** `apps/api/src/__tests__/__integration__/db/repositories/column-definitions.repository.integration.test.ts`

Add:

```ts
it("upsertByKey does not flip a custom row's `system` flag", async () => {
  // Seed a row as system: false manually, then upsert with the same key
  // using system: true in the insert payload — the `set` clause must not
  // include system, so the existing row stays system: false.
});
```

Run the three files — all three should fail.

### 2b. GREEN

1. **`apps/api/src/services/seed.service.ts`** — in `seedSystemColumnDefinitions`, include `system: true` in the `.update({ ... })` call. Also add `system: true` to the `SystemColumnDefinitionSpec` so the spec-to-row mapping is explicit.
2. **`apps/api/src/db/repositories/column-definitions.repository.ts`** — `upsertByKey`: do **not** add `system` to the `set` block. The insert path writes it; the update path preserves whatever is already there.

Green check: both test files pass.

---

## Phase 3 — Contracts: omit `system` from write bodies, expose on reads

### 3a. RED — contract test

**File:** `packages/core/src/__tests__/contracts/column-definition.contract.test.ts`

```ts
it("CreateRequestBody rejects a client-supplied system flag", () => {
  const res = ColumnDefinitionCreateRequestBodySchema.strict().safeParse({
    key: "foo", label: "Foo", type: "string", system: true,
  });
  expect(res.success).toBe(false);
});

it("UpdateRequestBody rejects a client-supplied system flag", () => {
  const res = ColumnDefinitionUpdateRequestBodySchema.strict().safeParse({
    label: "Foo", system: true,
  });
  expect(res.success).toBe(false);
});

it("ColumnDefinitionSchema exposes system on reads", () => {
  const shape = ColumnDefinitionSchema.shape;
  expect(shape.system).toBeDefined();
});
```

### 3b. GREEN

Only the read schema needs the field (inherited because we widened `ColumnDefinitionSchema` in Phase 1). Confirm that `ColumnDefinitionCreateRequestBodySchema` and `ColumnDefinitionUpdateRequestBodySchema` are defined with `z.object({...})` — not via `.extend(ColumnDefinitionSchema.pick(...))` — so they naturally omit `system`. Add `.strict()` if missing to reject extra keys.

Run tests.

---

## Phase 4 — API guardrails (router + ApiCode)

### 4a. RED — integration tests

**File:** `apps/api/src/__tests__/__integration__/routes/column-definition.router.integration.test.ts`

Add three tests:

```ts
it("POST / ignores a client-supplied system:true and persists system:false", async () => {
  const res = await authedRequest.post("/api/column-definitions").send({
    key: "foo_bar", label: "Foo Bar", type: "string", system: true,
  });
  expect(res.status).toBe(201);
  expect(res.body.payload.columnDefinition.system).toBe(false);
});

it("PATCH /:id returns 422 COLUMN_DEFINITION_SYSTEM_READONLY for a system row", async () => {
  const seeded = await columnDefsRepo.findByKey(organizationId, "email", db);
  const res = await authedRequest.patch(`/api/column-definitions/${seeded!.id}`)
    .send({ label: "Electronic Mail" });
  expect(res.status).toBe(422);
  expect(res.body.code).toBe("COLUMN_DEFINITION_SYSTEM_READONLY");
});

it("DELETE /:id returns 422 COLUMN_DEFINITION_SYSTEM_READONLY for a system row", async () => {
  const seeded = await columnDefsRepo.findByKey(organizationId, "email", db);
  const res = await authedRequest.delete(`/api/column-definitions/${seeded!.id}`);
  expect(res.status).toBe(422);
  expect(res.body.code).toBe("COLUMN_DEFINITION_SYSTEM_READONLY");
});
```

Assumes the integration harness seeds system column definitions as part of org setup — if it doesn't, use the existing `seedService.seedSystemColumnDefinitions` in the `beforeEach`.

### 4b. GREEN

1. **`apps/api/src/constants/api-codes.constants.ts`** — add `COLUMN_DEFINITION_SYSTEM_READONLY = "COLUMN_DEFINITION_SYSTEM_READONLY"` to the Column Definitions block.
2. **`apps/api/src/routes/column-definition.router.ts`** —
   - In **POST** (`columnDefinitionRouter.post("/", ...)`) after parsing, force `system: false` on the model payload: `model.update({ ..., system: false })`.
   - In **PATCH** (`columnDefinitionRouter.patch("/:id", ...)`) after the `existing` lookup and before the revalidation check, insert:
     ```ts
     if (existing.system) {
       return next(new ApiError(422, ApiCode.COLUMN_DEFINITION_SYSTEM_READONLY,
         "System column definitions are read-only"));
     }
     ```
   - In **DELETE** (`columnDefinitionRouter.delete("/:id", ...)`) add the same guard after `existing` is loaded.
3. **OpenAPI docs** in the same router: add `COLUMN_DEFINITION_SYSTEM_READONLY` to the listed 422 codes on PATCH and DELETE.

Run the router integration test file — should be green.

### 4c. REFACTOR

Extract the guard if desired:

```ts
// services/column-definition-validation.service.ts
static assertMutable(def: Pick<ColumnDefinition, "system">) {
  if (def.system) throw new ApiError(422, ApiCode.COLUMN_DEFINITION_SYSTEM_READONLY, "...");
}
```

Callsites: PATCH, DELETE, and any future mutation path. Re-run tests.

---

## Phase 5 — Remove column-definition AI tools from `entity_management`

Goal: the portal session cannot author column definitions. This is independent of Phase 4 but orthogonal — defence in depth. See discovery §10.

### 5a. RED — tools.service test

**File:** `apps/api/src/__tests__/services/tools.service.test.ts`

Add:

```ts
it("entity_management pack does NOT expose column_definition_* tools when hasWrite is true", async () => {
  const tools = await ToolsService.buildAnalyticsTools({
    /* station with entity_management pack and write capability */
  });
  expect(tools.column_definition_create).toBeUndefined();
  expect(tools.column_definition_update).toBeUndefined();
  expect(tools.column_definition_delete).toBeUndefined();
  // Sanity: field_mapping tools and read access are preserved
  expect(tools.field_mapping_create).toBeDefined();
});
```

**File:** `apps/api/src/__tests__/__integration__/tools/entity-management.integration.test.ts`

Remove any blocks that exercise `column_definition_create/update/delete`. Add:

```ts
it("does not register column_definition_* tool slugs", () => {
  expect(Object.keys(registeredTools)).toEqual(
    expect.not.arrayContaining(["column_definition_create", "column_definition_update", "column_definition_delete"]),
  );
});
```

### 5b. GREEN — surgical removal

1. **`apps/api/src/services/tools.service.ts`**:
   - Delete the three imports at lines 43–45.
   - Delete the three registrations at lines 263–265.
   - Delete the three slugs from `WRITE_TOOL_SLUGS` at lines 116–118.
2. **Delete** the tool files and their unit tests:
   - `apps/api/src/tools/column-definition-create.tool.ts` + `apps/api/src/__tests__/tools/column-definition-create.tool.test.ts`
   - `apps/api/src/tools/column-definition-update.tool.ts` + `apps/api/src/__tests__/tools/column-definition-update.tool.test.ts`
   - `apps/api/src/tools/column-definition-delete.tool.ts` + `apps/api/src/__tests__/tools/column-definition-delete.tool.test.ts`
3. **`apps/api/src/prompts/system.prompt.ts`** — rewrite the snippet around line 117. Replace:
   > *"To add a new field mapping, either find an existing column definition from `_column_definitions` or create one with column_definition_create, then call field_mapping_create."*

   With:
   > *"To add a new field mapping, find an existing column definition in `_column_definitions` and call field_mapping_create with its id. Column definitions are managed outside the portal session — if no suitable column definition exists, surface the unmapped source field to the user and stop; do not attempt to create one."*
4. Search the repo for any lingering references: `rg 'ColumnDefinition(Create|Update|Delete)Tool|column_definition_(create|update|delete)'` — should return only this doc and, if applicable, the discovery doc.

Run `npm run type-check` + tests. If any AI-tool analytics code (e.g. `AnalyticsService.applyColumnDefinitionUpdateMany`) is now unused, delete it in the refactor step.

### 5c. REFACTOR

- Delete any newly-orphaned `AnalyticsService` helpers (`applyColumnDefinitionUpdateMany`, `applyColumnDefinitionDeleteMany`, `applyColumnDefinitionCreateMany`) and their tests.
- Re-run full API test suite.

---

## Phase 6 — Web UI: System/Custom chip + disable edit/delete

### 6a. RED — card component test

**File:** `apps/web/src/__tests__/components/ColumnDefinition.component.test.tsx` (create if absent)

```tsx
import { render, screen } from "@testing-library/react";
import { ColumnDefinitionCardUI } from "../../components/ColumnDefinition.component";

const base = { /* minimal valid CD */, id: "cd-1", key: "email", label: "Email", type: "string", /* ... */ };

it("renders a Custom chip and a Delete action for non-system rows", () => {
  render(<ColumnDefinitionCardUI columnDefinition={{ ...base, system: false }} onDelete={jest.fn()} />);
  expect(screen.getByText("Custom")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
});

it("renders a System chip and NO Delete action for system rows", () => {
  render(<ColumnDefinitionCardUI columnDefinition={{ ...base, system: true }} onDelete={jest.fn()} />);
  expect(screen.getByText("System")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
});
```

### 6b. GREEN — card

**`apps/web/src/components/ColumnDefinition.component.tsx`**

```tsx
const actions: ActionSuiteItem[] = !cd.system && onDelete
  ? [{ label: "Delete", icon: <DeleteIcon />, onClick: () => onDelete(cd), color: "error" }]
  : [];

// Inside the MetadataList items array, prepend:
{
  label: "Origin",
  value: (
    <Chip
      label={cd.system ? "System" : "Custom"}
      size="small"
      color={cd.system ? "default" : "primary"}
      variant="outlined"
    />
  ),
  variant: "chip",
},
```

Run the test — should pass.

### 6c. RED — detail view test

**File:** `apps/web/src/__tests__/views/ColumnDefinitionDetail.view.test.tsx` (create if absent)

```tsx
it("disables Edit and Delete when the column definition is system", async () => {
  // mock sdk.columnDefinitions.get to return { system: true, ... }
  render(<ColumnDefinitionDetailView columnDefinitionId="cd-1" />, { wrapper });
  const edit = await screen.findByRole("button", { name: /edit/i });
  expect(edit).toBeDisabled();
  // Open the secondary-action menu, assert Delete is absent or disabled
});

it("keeps Edit and Delete enabled for custom column definitions", async () => {
  // mock sdk.columnDefinitions.get to return { system: false, ... }
  // ...
});
```

### 6d. GREEN — detail view

**`apps/web/src/views/ColumnDefinitionDetail.view.tsx`**

- Add the Origin chip to the `PageHeader > MetadataList` items (same shape as the card).
- Change the primary action to:
  ```tsx
  <Button
    variant="contained"
    startIcon={<EditIcon />}
    onClick={() => setEditDialogOpen(true)}
    disabled={cd.system}
    title={cd.system ? "System column definitions are read-only" : undefined}
  >
    Edit
  </Button>
  ```
- Filter the secondary Delete action:
  ```tsx
  secondaryActions={
    cd.system
      ? []
      : [{ label: "Delete", icon: <DeleteIcon />, onClick: () => setDeleteDialogOpen(true), color: "error" }]
  }
  ```

If `PageHeader`'s `secondaryActions` already supports a `disabled` prop, prefer that so the action stays visible but un-clickable with a tooltip — check `@portalai/core/ui` for support before adding a new prop.

### 6e. REFACTOR

- Extract the chip cell into a small local `OriginChip` component if both the card and detail use it verbatim.
- Confirm the Storybook story for `ColumnDefinitionCardUI` covers both `system: true` and `system: false` (add if missing).

---

## Phase 7 — Optional: `system` filter on the list endpoint

Skip if not wanted in v1; landing 1–6 is the shippable minimum.

### 7a. RED

- Contract test: `ColumnDefinitionListRequestQuerySchema` accepts `system: "true" | "false"`.
- Router integration: `GET /api/column-definitions?system=false` excludes seeded rows.

### 7b. GREEN

- Extend `ColumnDefinitionListRequestQuerySchema` in `packages/core/src/contracts/column-definition.contract.ts`.
- Parse in `columnDefinitionRouter.get("/", ...)` and add `eq(columnDefinitions.system, boolValue)` to the `filters` array.
- Add a filter chip in `ColumnDefinitionListView`'s `usePagination` config: `{ type: "boolean", field: "system", label: "Origin", options: [{ label: "Custom", value: "false" }, { label: "System", value: "true" }] }` (adapt to the actual `usePagination` filter shape).

---

## Phase 8 — Full green + manual QA

1. Root: `npm run lint && npm run type-check && npm run test`.
2. Start dev: `npm run dev`.
3. Manual:
   - Fresh org → list shows 26 rows, all chipped "System", all with disabled Edit / no Delete.
   - Create a new column definition → chipped "Custom", Edit + Delete enabled, succeed on both.
   - Try `curl -X PATCH /api/column-definitions/<system-id>` with a valid token → 422 with `COLUMN_DEFINITION_SYSTEM_READONLY`.
   - Try `curl -X POST /api/column-definitions -d '{... "system": true}'` → 201 with `system: false` in response.
   - Start a portal session with the `entity_management` pack — prompt the model to "add a new field called widgets"; confirm the model does not invoke `column_definition_create` (it was unregistered) and surfaces the unmapped field to the user instead.
4. Storybook: `npm run storybook` — verify `ColumnDefinitionCardUI` stories for both variants render correctly.

---

## Commit strategy

Land in phase-sized commits so review is digestible:

1. `feat(core): add system flag to ColumnDefinition model` (Phase 1a–b)
2. `feat(api): add system column + migration for column_definitions` (Phase 1c)
3. `feat(api): persist system flag from seeder; keep upsertByKey stable` (Phase 2)
4. `feat(core): omit system from CD write contracts` (Phase 3)
5. `feat(api): guard CD mutations with COLUMN_DEFINITION_SYSTEM_READONLY` (Phase 4)
6. `refactor(api): remove column_definition_* AI tools from entity_management` (Phase 5)
7. `feat(web): system vs custom chip and read-only UI for system CDs` (Phase 6)
8. `feat(api,web): system filter on list endpoint` (Phase 7, optional)

Each commit should leave the tree green.
