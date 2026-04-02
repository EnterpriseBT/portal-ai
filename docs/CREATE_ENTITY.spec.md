# Create Entity — Specification

## 1. Overview

A "Create Entity" dialog allowing users to create a new connector entity. The dialog is reachable from two entry points, sharing one component with different configurations.

### Entry Points

| Entry Point | Location | Connector Instance Behavior |
|-------------|----------|----------------------------|
| Entities view | `PageHeader` primaryAction on `/entities` | User selects from writable instances (single-select `Autocomplete`) |
| Connector Instance view | `PageSection` primaryAction in the "Entities" section on `/connectors/:id` | Pre-filled with current instance, field is **disabled** |

---

## 2. API: Capability Filter on Connector Instances

### 2.1 Contract Change

**File**: `packages/core/src/contracts/connector-instance.contract.ts`

Add `capability` to `ConnectorInstanceListRequestQuerySchema`:

```ts
export const ConnectorInstanceListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  connectorDefinitionId: z.string().optional(),
  status: z.string().optional(),
  include: z.string().optional(),
  capability: z.string().optional(), // NEW — comma-separated: "read", "write", "sync"
});
```

### 2.2 Router Change

**File**: `apps/api/src/routes/connector-instance.router.ts`

In the `GET /` handler, after existing filters:

1. Destructure `capability` from the parsed query.
2. Split on comma, trim, and filter to valid capability names (`read`, `write`, `sync`).
3. For each valid capability, push a SQL condition:
   ```sql
   enabled_capability_flags->>'<capability>' = 'true'
   ```
   Use Drizzle's `sql` template literal for safe interpolation of the JSONB key.

**Valid capabilities**: `read`, `write`, `sync`. Invalid values are silently ignored.

### 2.3 OpenAPI Update

Add to the existing `GET /api/connector-instances` parameter docs:

```yaml
- in: query
  name: capability
  schema:
    type: string
  description: >
    Comma-separated list of required capability flags (read, write, sync).
    Only instances where all specified flags are enabled will be returned.
```

---

## 3. Frontend SDK: Create Mutation

**File**: `apps/web/src/api/connector-entities.api.ts`

Add `create` to the `connectorEntities` SDK object:

```ts
create: () =>
  useAuthMutation<ConnectorEntityCreateResponsePayload, ConnectorEntityCreateRequestBody>({
    url: "/api/connector-entities",
    method: "POST",
  }),
```

Import `ConnectorEntityCreateRequestBody` and `ConnectorEntityCreateResponsePayload` from `@portalai/core/contracts`.

---

## 4. CreateConnectorEntityDialog Component

**File**: `apps/web/src/components/CreateConnectorEntityDialog.component.tsx` *(new)*

### 4.1 Props Interface

```ts
interface CreateConnectorEntityDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: ConnectorEntityCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
  lockedConnectorInstance: { id: string; name: string } | null;
}
```

### 4.2 Form State

```ts
interface EntityFormState {
  label: string;
  key: string;
  connectorInstanceId: string;
}

const INITIAL_FORM: EntityFormState = {
  label: "",
  key: "",
  connectorInstanceId: "",
};
```

When `open` changes to `true`, reset form state. If `lockedConnectorInstance` is provided, set `connectorInstanceId` to `lockedConnectorInstance.id`.

### 4.3 Validation Schema

```ts
const EntityFormSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores"
    ),
  connectorInstanceId: z.string().min(1, "Connector instance is required"),
});
```

This mirrors the `ConnectorEntityCreateRequestBodySchema` from `@portalai/core/contracts` with user-friendly error messages.

### 4.4 Form Fields

Rendered top-to-bottom inside a `<Stack spacing={2.5}>`:

#### Field 1: Label

```
TextField
  inputRef={labelRef}           // useDialogAutoFocus(open)
  label="Label"
  required
  fullWidth
  error, helperText, aria-invalid  // standard touched/errors pattern
```

#### Field 2: Key

```
TextField
  label="Key"
  required
  fullWidth
  error, helperText, aria-invalid  // standard touched/errors pattern
```

#### Field 3: Connector Instance

**When `lockedConnectorInstance` is `null`** (Entities view):

```
Autocomplete
  options={writableInstances}       // from sdk.connectorInstances.list({ capability: "write", limit: 100, sortBy: "name", sortOrder: "asc" })
  getOptionLabel={(o) => o.label}
  value={selectedOption}
  onChange={...}
  disabled={isLoading}
  renderInput={(params) => (
    <TextField
      {...params}
      label="Connector Instance"
      required
      placeholder={isLoading ? "Loading..." : "Select a connector instance..."}
      error, helperText, aria-invalid  // standard pattern
    />
  )}
```

Options are `{ value: string; label: string }[]` mapped from the API response's `connectorInstances` array (`{ value: ci.id, label: ci.name }`).

**When `lockedConnectorInstance` is provided** (Connector Instance view):

```
TextField
  label="Connector Instance"
  value={lockedConnectorInstance.name}
  disabled
  fullWidth
```

No fetch occurs. The `connectorInstanceId` is taken directly from `lockedConnectorInstance.id` on submit.

#### Field 4: FormAlert

```
<FormAlert serverError={serverError} />
```

### 4.5 Modal Structure

```tsx
<Modal
  open={open}
  onClose={onClose}
  title="New Entity"
  maxWidth="sm"
  fullWidth
  slotProps={{
    paper: {
      component: "form",
      onSubmit: (e: React.FormEvent) => {
        e.preventDefault();
        handleSubmit();
      },
    } as object,
  }}
  actions={
    <Stack direction="row" spacing={1}>
      <Button type="button" variant="outlined" onClick={onClose} disabled={isPending}>
        Cancel
      </Button>
      <Button type="button" variant="contained" onClick={handleSubmit} disabled={isPending}>
        {isPending ? "Creating..." : "Create"}
      </Button>
    </Stack>
  }
>
```

### 4.6 Submission Logic

```ts
const handleSubmit = () => {
  setTouched({ label: true, key: true, connectorInstanceId: true });
  const formErrors = validateForm(form);
  setErrors(formErrors);
  if (Object.keys(formErrors).length > 0) {
    requestAnimationFrame(() => focusFirstInvalidField());
    return;
  }
  onSubmit({
    label: form.label.trim(),
    key: form.key,
    connectorInstanceId: form.connectorInstanceId,
  });
};
```

---

## 5. Entities View Integration

**File**: `apps/web/src/views/Entities.view.tsx`

### 5.1 UI Component (`EntitiesViewUI`)

Add to `EntitiesViewUIProps`:

```ts
onCreate: () => void;
```

Add a "Create Entity" button as `primaryAction` on `PageHeader`:

```tsx
<PageHeader
  ...
  primaryAction={
    <Button variant="contained" onClick={onCreate}>
      Create Entity
    </Button>
  }
/>
```

### 5.2 Container Component (`EntitiesView`)

```ts
const [createOpen, setCreateOpen] = useState(false);
const createMutation = sdk.connectorEntities.create();

const handleCreateClose = useCallback(() => {
  setCreateOpen(false);
  createMutation.reset();
}, [createMutation]);

const handleCreateSubmit = useCallback(
  (body: ConnectorEntityCreateRequestBody) => {
    createMutation.mutate(body, {
      onSuccess: () => {
        handleCreateClose();
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
      },
    });
  },
  [createMutation, handleCreateClose, queryClient]
);
```

Render:

```tsx
<CreateConnectorEntityDialog
  open={createOpen}
  onClose={handleCreateClose}
  onSubmit={handleCreateSubmit}
  isPending={createMutation.isPending}
  serverError={toServerError(createMutation.error)}
  lockedConnectorInstance={null}
/>
```

Pass `onCreate={() => setCreateOpen(true)}` to `EntitiesViewUI`.

---

## 6. Connector Instance View Integration

**File**: `apps/web/src/views/ConnectorInstance.view.tsx`

### 6.1 State & Mutation

```ts
const [createEntityOpen, setCreateEntityOpen] = useState(false);
const createEntityMutation = sdk.connectorEntities.create();
```

### 6.2 Handlers

```ts
const handleCreateEntityClose = useCallback(() => {
  setCreateEntityOpen(false);
  createEntityMutation.reset();
}, [createEntityMutation]);

const handleCreateEntitySubmit = useCallback(
  (body: ConnectorEntityCreateRequestBody) => {
    createEntityMutation.mutate(body, {
      onSuccess: () => {
        handleCreateEntityClose();
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
      },
    });
  },
  [createEntityMutation, handleCreateEntityClose, queryClient]
);
```

### 6.3 UI Placement

Add a "Create Entity" button as the `primaryAction` prop on the Entities `PageSection`:

```tsx
<PageSection
  title="Entities"
  icon={<Icon name={IconName.DataObject} />}
  primaryAction={
    <Button variant="contained" size="small" onClick={() => setCreateEntityOpen(true)}>
      Create Entity
    </Button>
  }
>
```

### 6.4 Dialog Render

Render alongside the existing dialogs (`DeleteConnectorInstanceDialog`, `EditConnectorInstanceDialog`):

```tsx
<CreateConnectorEntityDialog
  open={createEntityOpen}
  onClose={handleCreateEntityClose}
  onSubmit={handleCreateEntitySubmit}
  isPending={createEntityMutation.isPending}
  serverError={toServerError(createEntityMutation.error)}
  lockedConnectorInstance={{ id: connectorInstanceId, name: ci.name }}
/>
```

---

## 7. Cache Invalidation

On successful entity creation, invalidate:

```ts
queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
```

This covers both the Entities list view and the Connector Instance detail view's entity section, since both query under the same root key.

---

## 8. Accessibility

| Requirement | Implementation |
|-------------|----------------|
| Auto-focus | `useDialogAutoFocus(open)` ref on the Label field |
| Field errors | `error={touched[field] && !!errors[field]}` + `helperText={touched[field] && errors[field]}` on every validated `TextField` |
| `aria-invalid` | `slotProps.htmlInput["aria-invalid"]` (or `inputProps["aria-invalid"]` for `Autocomplete` renderInput) set to `touched[field] && !!errors[field]` |
| `required` | `required` prop on all three field inputs |
| Server errors | `<FormAlert>` renders MUI `<Alert>` which provides `role="alert"` automatically |
| Disabled field | When `lockedConnectorInstance` is set, the connector instance field is `disabled` — screen readers announce it as unavailable |
| Focus on error | `focusFirstInvalidField()` scrolls to and focuses the first `[aria-invalid="true"]` element after a failed submit |

---

## 9. Test Plan

**File**: `apps/web/src/__tests__/CreateConnectorEntityDialog.component.test.tsx` *(new)*

### 9.1 Rendering

| # | Test Case |
|---|-----------|
| 1 | Renders dialog title "New Entity" and all fields when `open={true}` |
| 2 | Does not render dialog content when `open={false}` |

### 9.2 Submission

| # | Test Case |
|---|-----------|
| 3 | Calls `onSubmit` with `{ label, key, connectorInstanceId }` on Create button click |
| 4 | Calls `onSubmit` on Enter key (form submit event) |
| 5 | Does **not** call `onSubmit` when validation fails |

### 9.3 Cancel / Close

| # | Test Case |
|---|-----------|
| 6 | Calls `onClose` on Cancel button click |

### 9.4 Loading State

| # | Test Case |
|---|-----------|
| 7 | Create button shows "Creating..." and both buttons are disabled when `isPending={true}` |

### 9.5 Server Errors

| # | Test Case |
|---|-----------|
| 8 | Renders `<FormAlert>` with error message when `serverError` is provided |
| 9 | Does not render `<FormAlert>` when `serverError` is `null` |

### 9.6 Field Validation

| # | Test Case |
|---|-----------|
| 10 | Shows "Label is required" when label is empty on submit |
| 11 | Shows key format error when key contains invalid characters (e.g. uppercase, starts with number) |
| 12 | Shows "Connector instance is required" when no instance selected on submit (unlocked mode) |
| 13 | `aria-invalid="true"` is set on each invalid field after failed submit |
| 14 | `required` attribute is present on Label, Key, and Connector Instance inputs |

### 9.7 Locked Connector Instance

| # | Test Case |
|---|-----------|
| 15 | When `lockedConnectorInstance` is provided, connector instance field displays the instance name and is disabled |
| 16 | When `lockedConnectorInstance` is provided, `onSubmit` payload uses `lockedConnectorInstance.id` as `connectorInstanceId` |
| 17 | When `lockedConnectorInstance` is `null`, connector instance field is enabled and selectable |

---

## 10. Files Changed

| File | Action |
|------|--------|
| `packages/core/src/contracts/connector-instance.contract.ts` | Add `capability` to `ConnectorInstanceListRequestQuerySchema` |
| `apps/api/src/routes/connector-instance.router.ts` | Parse `capability` query param, add JSONB SQL filter, update OpenAPI docs |
| `apps/web/src/api/connector-entities.api.ts` | Add `create` mutation |
| `apps/web/src/components/CreateConnectorEntityDialog.component.tsx` | New dialog component |
| `apps/web/src/views/Entities.view.tsx` | Add "Create Entity" button to `PageHeader`, wire dialog with `lockedConnectorInstance={null}` |
| `apps/web/src/views/ConnectorInstance.view.tsx` | Add "Create Entity" button to Entities `PageSection`, wire dialog with locked instance |
| `apps/web/src/__tests__/CreateConnectorEntityDialog.component.test.tsx` | New test file (17 test cases) |
