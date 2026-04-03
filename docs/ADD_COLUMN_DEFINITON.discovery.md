# Add Column Definition — Discovery Summary

## Goal

Enable users to create column definitions from the app UI via a "Create Column Definition" primary action on the list view, opening a validated dialog form.

---

## What Already Exists

| Layer | File | Status |
|-------|------|--------|
| Zod model | `packages/core/src/models/column-definition.model.ts` | Complete |
| Contract (create) | `packages/core/src/contracts/column-definition.contract.ts` | Complete — `ColumnDefinitionCreateRequestBodySchema` and response types defined |
| Drizzle table | `apps/api/src/db/schema/column-definitions.table.ts` | Complete |
| Repository | `apps/api/src/db/repositories/column-definitions.repository.ts` | Complete — inherits `create()` from base `Repository` |
| API route | `apps/api/src/routes/column-definition.router.ts` | Complete — `POST /api/column-definitions` endpoint exists |
| List view | `apps/web/src/views/ColumnDefinitionList.view.tsx` | Exists but has **no create button or dialog** |
| SDK hooks | `apps/web/src/api/column-definitions.api.ts` | **Missing `create` method** |

The backend is fully wired. The gap is entirely frontend.

---

## Changes Required

### 1. Add `create` method to SDK — `apps/web/src/api/column-definitions.api.ts`

Add a `create` hook following the existing pattern (see `stations.api.ts`, `portals.api.ts`):

```ts
create: () =>
  useAuthMutation<ColumnDefinitionCreateResponsePayload, ColumnDefinitionCreateRequestBody>({
    url: "/api/column-definitions",
    method: "POST",
  }),
```

Imports needed: `ColumnDefinitionCreateRequestBody`, `ColumnDefinitionCreateResponsePayload` from `@portalai/core/contracts`.

### 2. Create dialog component — `apps/web/src/components/CreateColumnDefinitionDialog.component.tsx`

New dialog following the `CreateStationDialog` pattern.

**Props:**

```ts
interface CreateColumnDefinitionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: ColumnDefinitionCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}
```

**Form state:**

| Field | Type | Validation | Notes |
|-------|------|-----------|-------|
| `key` | text | Required, regex `/^[a-z][a-z0-9_]*$/` | Immutable after creation — inform user |
| `label` | text | Required, min 1 char | Auto-focused via `useDialogAutoFocus` |
| `type` | select | Required, one of `ColumnDataTypeEnum.options` | All 11 types available on create |
| `description` | text (multiline) | Optional | |
| `required` | switch | Optional, default `false` | |
| `defaultValue` | text | Optional | |
| `format` | text | Optional | |
| `enumValues` | text | Optional, comma-separated | Only visible when `type === "enum"` |

**Validation schema** (local to component, mirrors `ColumnDefinitionCreateRequestBodySchema`):

```ts
const CreateColumnDefinitionFormSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase alphanumeric with underscores, starting with a letter"),
  label: z.string().trim().min(1, "Label is required"),
  type: ColumnDataTypeEnum,
});
```

Only the required fields need client-side validation — optional fields are validated server-side.

**Conventions to follow:**
- `<Modal>` with `slotProps.paper.component="form"` and `onSubmit` handler
- `useDialogAutoFocus(open)` on the first field (`key`)
- `touched` / `errors` state with `validateWithSchema` + `focusFirstInvalidField`
- `<FormAlert serverError={serverError} />` for server errors
- Reset form state on `open` change via `useEffect`
- Cancel and Create action buttons with `isPending` loading state

### 3. Integrate into list view — `apps/web/src/views/ColumnDefinitionList.view.tsx`

Refactor to container/UI split (matching `Stations.view.tsx`):

**Container adds:**
- `createOpen` state + `createMutation` via `sdk.columnDefinitions.create()`
- `handleOpenCreate`, `handleCreateClose`, `handleCreateSubmit` callbacks
- `queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root })` on success

**UI adds:**
- `primaryAction` prop on `<PageHeader>` with a "Create Column Definition" button (Add icon)
- `<CreateColumnDefinitionDialog>` rendered with mutation state

### 4. Tests — `apps/web/src/__tests__/CreateColumnDefinitionDialog.test.tsx`

Following the dialog test checklist from CLAUDE.md:

- Renders when `open={true}`, hidden when `open={false}`
- Calls `onSubmit` with correct body on valid submission
- Enter key triggers form submission
- Calls `onClose` on Cancel
- Shows loading state when `isPending={true}`
- Renders `<FormAlert>` when `serverError` provided
- Field-level validation errors on invalid key format
- `aria-invalid` set on invalid fields
- `required` attribute on required fields
- Enum values field only visible when type is "enum"

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/components/CreateColumnDefinitionDialog.component.tsx` | Dialog component |
| `apps/web/src/__tests__/CreateColumnDefinitionDialog.test.tsx` | Dialog tests |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/api/column-definitions.api.ts` | Add `create` method |
| `apps/web/src/views/ColumnDefinitionList.view.tsx` | Add container wrapper, create button, dialog integration |

---

## Out of Scope

- Backend changes — `POST /api/column-definitions` already works
- Contract/model changes — `ColumnDefinitionCreateRequestBodySchema` already defined
- Edit dialog changes — already exists separately
- Navigation after create (staying on list page, matching station pattern)
