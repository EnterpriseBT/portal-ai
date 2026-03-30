# UI/UX Quality Audit — Frontend Application
**Date:** 2026-03-30
**Branch:** feat/uiux-audit
**Scope:** Forms, Error Display, Accessibility

---

## Executive Summary

The frontend uses a consistent manual validation pattern across all forms (touched state + inline error checks). However, **no forms use Zod schemas** for validation despite Zod being a core dependency in the monorepo. API errors are surfaced in most dialog forms via a `serverError` prop, but several forms silently swallow errors. **No native `<form>` elements exist** — all forms are built with MUI components and button click handlers, meaning Enter-key submission is missing from nearly every form. Accessibility is minimal: no `aria-invalid`, no `aria-describedby` linking errors to fields, and limited `aria-label` usage.

---

## 1. FORMS — Inventory & Findings

### 1.1 Form Inventory

| Component | Location | Fields | Validation | Server Error Display |
|-----------|----------|--------|------------|---------------------|
| CreateStationDialog | `components/CreateStationDialog.component.tsx` | name, description, toolPacks, connectorInstances | Manual (name required, toolPacks ≥ 1) | ✅ Yes |
| EditStationDialog | `components/EditStationDialog.component.tsx` | name, description, toolPacks, connectorInstances | Manual (name required, toolPacks ≥ 1) | ✅ Yes |
| CreatePortalDialog | `components/CreatePortalDialog.component.tsx` | stationId | Manual (station required) | ✅ Yes |
| TagFormModal | `components/TagFormModal.component.tsx` | name, color, description | Manual (name required, hex color regex) | ✅ Yes |
| EditConnectorInstanceDialog | `components/EditConnectorInstanceDialog.component.tsx` | name | Manual (non-empty trim) | ✅ Yes |
| DeleteStationDialog | `components/DeleteStationDialog.component.tsx` | (none — confirmation) | N/A | ❌ No |
| DeletePortalDialog | `components/DeletePortalDialog.component.tsx` | (none — confirmation) | N/A | ❌ No |
| DeleteConnectorInstanceDialog | `components/DeleteConnectorInstanceDialog.component.tsx` | (none — confirmation) | N/A | ✅ Yes (Alert) |
| DeleteTagDialog | `components/DeleteTagDialog.component.tsx` | (none — confirmation) | N/A | ❌ No |
| CSVConnector UploadStep | `workflows/CSVConnector/UploadStep.component.tsx` | file upload | Server-side | ✅ StatusMessage |
| CSVConnector EntityStep | `workflows/CSVConnector/EntityStep.component.tsx` | entity key/label | None client-side | ❌ No |
| CSVConnector ColumnMappingStep | `workflows/CSVConnector/ColumnMappingStep.component.tsx` | column mappings | None client-side | ❌ No |
| CSVConnector ReviewStep | `workflows/CSVConnector/ReviewStep.component.tsx` | (read-only) | N/A | ✅ StatusMessage |
| EntityGroupDetail (inline edit) | `views/EntityGroupDetail.view.tsx` | group name | None | ❌ No |
| EntityGroupDetail (add member) | `views/EntityGroupDetail.view.tsx` | entity, link field | None | ❌ No |

### 1.2 Validation Issues

**[CRITICAL] No Zod schema validation on any frontend form**
- All forms use ad-hoc manual validation (`if (!form.name.trim()) errors.name = "..."`)
- Zod schemas exist in `@portalai/core` for every domain model but are never imported or used for form validation
- This creates drift risk between what the frontend accepts and what the backend expects

**[HIGH] Inconsistent validation coverage**
- CreateStationDialog & EditStationDialog: Good — validates name + toolPacks
- TagFormModal: Good — validates name + hex color format
- CreatePortalDialog: Minimal — only checks station selection
- EntityGroupDetail inline edit: No validation at all — empty name can be submitted
- CSVConnector EntityStep & ColumnMappingStep: No client-side validation

**[MEDIUM] No maxLength enforcement on text inputs**
- TextField components have no `inputProps={{ maxLength }}` even though backend likely has column limits
- Users can type unlimited text and only discover truncation/error on submit

### 1.3 `<form>` Elements & Enter Key Submission

**[HIGH] No `<form>` elements exist for data submissions**

Every data-submission surface in the app uses bare `onClick` handlers on buttons instead of a `<form onSubmit>` wrapper. This breaks native Enter-key submission, prevents the browser from associating fields with a submit action, and removes the semantic `form` landmark for assistive technology.

**Required change:** Wrap each submission surface in a `<form>` with an `onSubmit` handler that calls `event.preventDefault()` and runs the existing validation → submit logic. The current submit `<Button>` should become `type="submit"`.

| Component | File | Needs `<form>` | Notes |
|-----------|------|:-:|-------|
| CreateStationDialog | `components/CreateStationDialog.component.tsx` | ✅ | Wrap DialogContent fields + DialogActions in `<form>` |
| EditStationDialog | `components/EditStationDialog.component.tsx` | ✅ | Same structure as Create |
| CreatePortalDialog | `components/CreatePortalDialog.component.tsx` | ✅ | Station select + submit |
| TagFormModal | `components/TagFormModal.component.tsx` | ✅ | Name, color, description fields |
| EditConnectorInstanceDialog | `components/EditConnectorInstanceDialog.component.tsx` | ✅ | Single name field |
| DeleteStationDialog | `components/DeleteStationDialog.component.tsx` | ✅ | Confirmation submit |
| DeletePortalDialog | `components/DeletePortalDialog.component.tsx` | ✅ | Confirmation submit |
| DeleteConnectorInstanceDialog | `components/DeleteConnectorInstanceDialog.component.tsx` | ✅ | Confirmation submit |
| DeleteTagDialog | `components/DeleteTagDialog.component.tsx` | ✅ | Confirmation submit |
| EntityGroupDetail (inline edit) | `views/EntityGroupDetail.view.tsx` | ⚠️ | Already has `onKeyDown` Enter handler — keep as-is or convert to inline `<form>` |
| EntityGroupDetail (add member) | `views/EntityGroupDetail.view.tsx` | ✅ | Dialog-based member add |
| CSVConnector ReviewStep | `workflows/CSVConnector/ReviewStep.component.tsx` | ✅ | Final confirm action |

**Implementation pattern:**
```tsx
// Before (current — no <form>, no Enter key support)
<DialogContent>
  <TextField ... />
</DialogContent>
<DialogActions>
  <Button onClick={handleCancel}>Cancel</Button>
  <Button onClick={handleSubmit}>Save</Button>
</DialogActions>

// After (semantic <form> with native Enter key submission)
<form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
  <DialogContent>
    <TextField ... />
  </DialogContent>
  <DialogActions>
    <Button onClick={handleCancel}>Cancel</Button>
    <Button type="submit">Save</Button>
  </DialogActions>
</form>
```

**Current Enter key support audit:**
- EntityGroupDetail inline name edit: ✅ Has `onKeyDown` handler for Enter
- All other forms (11 components): ❌ No Enter key support — user must click submit button

### 1.4 AutoFocus

**[OK] Most dialog forms correctly autoFocus the first field**
- CreateStationDialog: ✅ `autoFocus` on name
- EditStationDialog: ✅ `autoFocus` on name
- TagFormModal: ✅ `autoFocus` on name
- EditConnectorInstanceDialog: ✅ `autoFocus` on name
- CreatePortalDialog: ❌ No autoFocus on station select
- CSVConnector steps: ❌ No autoFocus on any fields

---

## 2. ERROR DISPLAY — Findings

### 2.1 API Error Architecture

**Backend returns:**
```json
{
  "success": false,
  "message": "Human-readable error message",
  "code": "DOMAIN_FAILURE"
}
```

**Frontend captures via `ApiError` class** (`utils/api.util.ts`):
- `message: string` — from response body
- `code: string` — machine-readable code (e.g., `ENTITY_TAG_DUPLICATE_NAME`)
- `status: number` — HTTP status code

**Mutations expose errors as** `mutation.error?.message` via TanStack Query.

### 2.2 ApiError `code` Not Surfaced

**[HIGH] Error `code` is discarded before reaching UI components**

The `ApiError` class captures both `message` and `code` from the backend, but every parent view strips the error down to just the message string before passing it to dialog components:

```tsx
// Current — code is lost
serverError={createMutation.error?.message ?? null}
```

All dialog props type `serverError` as `string | null`, so even if the code were passed, components couldn't use it.

**Affected parent views (where code is stripped):**
| View | File | Mutation(s) |
|------|------|-------------|
| Stations | `views/Stations.view.tsx` | `createMutation.error?.message` |
| StationDetail | `views/StationDetail.view.tsx` | `updateMutation.error?.message` |
| Dashboard | `views/Dashboard.view.tsx` | `createMutation.error?.message` |
| Tags | `views/Tags.view.tsx` | `activeMutation.error?.message` |
| EntityGroups | `views/EntityGroups.view.tsx` | `createMutation.error?.message` |

**Required change:** Pass the full `ApiError` (or at minimum `{ message, code }`) to components so the error code can be displayed alongside the message.

```tsx
// Props — accept structured error instead of bare string
interface DialogProps {
  serverError: { message: string; code: string } | null;
}

// Parent view — pass message + code
serverError={
  createMutation.error
    ? { message: createMutation.error.message, code: createMutation.error.code }
    : null
}

// Display — show code alongside message
{serverError && (
  <Alert severity="error">
    {serverError.message} <Typography component="span" variant="caption" color="text.secondary">({serverError.code})</Typography>
  </Alert>
)}
```

This lets users (and support/developers) identify the exact error condition from the backend. Codes like `ENTITY_TAG_DUPLICATE_NAME` or `UPLOAD_FILE_TOO_LARGE` are far more actionable than the message alone.

### 2.3 Error Display — Missing Surfaces

**[HIGH] Delete dialogs silently fail (3 of 4)**
- DeleteStationDialog: No `serverError` prop — if delete fails, dialog just stays open with no feedback
- DeletePortalDialog: No `serverError` prop — same silent failure
- DeleteTagDialog: No `serverError` prop — same silent failure
- DeleteConnectorInstanceDialog: ✅ Correctly shows MUI Alert on error

**[HIGH] EntityGroupDetail swallows errors**
- Group name update: No error display if mutation fails
- Add member: No error display if mutation fails
- Delete group: No error display if mutation fails
- Overlap preview fetch: Catches errors silently (`catch { setOverlap(null) }`)

**[MEDIUM] CSVConnector workflow gaps**
- EntityStep: No error display for invalid entity configurations
- ColumnMappingStep: No error display for invalid mappings
- Errors only surface at ReviewStep confirmation stage

**[LOW] No global error notification system**
- No Snackbar/Toast provider for transient error messages
- All errors are inline within components — if a component unmounts, the error is lost
- Operations that happen outside dialogs (e.g., mutations triggered from list views) have no error surface

### 2.4 Error Display Patterns (Current)

**Pattern A — Dialog inline error (most common):**
```tsx
{serverError && (
  <Typography variant="body2" color="error">
    {serverError}
  </Typography>
)}
```

**Pattern B — StatusMessage component (workflows):**
```tsx
<StatusMessage message={error} variant="error" />
```

**Pattern C — MUI Alert (DeleteConnectorInstanceDialog only):**
```tsx
<Alert severity="error">{serverError}</Alert>
```

**Recommendation:** Standardize on MUI Alert for form errors — it has built-in icon, proper ARIA role, and better visual weight than plain Typography.

---

## 3. ACCESSIBILITY — Findings

### 3.1 ARIA Attributes

**[CRITICAL] No `aria-invalid` on error fields**
- MUI TextField `error` prop adds visual styling only
- Screen readers cannot programmatically determine field validity
- Fix: Add `aria-invalid={touched.field && !!errors.field}` via `inputProps`

**[CRITICAL] No `aria-describedby` linking error messages to fields**
- Error helper text is visually associated but not programmatically linked
- MUI TextField `helperText` does auto-generate `aria-describedby` when present ✅
- However, the `error` prop alone does NOT add `aria-invalid` — must be explicit

**[HIGH] No `aria-label` on icon-only buttons**
- Delete buttons, edit buttons, and action icons throughout the app lack labels
- Screen readers announce these as unlabeled buttons

**[HIGH] No `aria-required` on required form fields**
- Required fields only show visual asterisks (if any) — no programmatic indication
- Fix: Add `required` prop to MUI TextField (adds both visual asterisk and `aria-required`)

### 3.2 Keyboard Navigation

**[HIGH] Dialog forms not keyboard-accessible for submission**
- No `<form>` wrapper means Enter key doesn't trigger submit
- Tab order within dialogs relies on MUI Dialog's built-in focus trap (which is good)
- But users must Tab to the submit button and press Space/Enter

**[MEDIUM] No focus management after form errors**
- When validation fails on submit, focus stays on the submit button
- Should move focus to the first invalid field for screen reader announcement

### 3.3 Color and Contrast

**[MEDIUM] Error text relies solely on color**
- `color="error"` on Typography uses theme error color
- No icon or prefix text for colorblind users
- MUI Alert component would solve this (has error icon by default)

### 3.4 Screen Reader Announcements

**[MEDIUM] No live regions for dynamic error messages**
- Server errors appear asynchronously but are not announced
- Fix: Add `aria-live="polite"` to error message containers, or use MUI Alert (has `role="alert"` built-in)

---

## 4. RECOMMENDATIONS — Priority Order

### P0 (Critical — Accessibility Compliance)

1. **Wrap dialog form content in `<form onSubmit={...}>`** with `event.preventDefault()`
   - Enables native Enter key submission
   - Provides semantic form landmark for screen readers
   - Apply to: All dialog forms (Create/Edit Station, Create Portal, Tag Form, Edit Connector Instance)

2. **Add `aria-invalid` and `required` to form fields**
   - Use MUI TextField `required` prop for required fields
   - Add `inputProps={{ "aria-invalid": touched && !!error }}` for error state

3. **Switch error display from Typography to MUI Alert**
   - Provides `role="alert"` for screen reader announcement
   - Includes error icon for non-color indication
   - Consistent visual pattern

### P1 (High — Form Quality)

4. **Integrate Zod schemas for form validation**
   - Import existing schemas from `@portalai/core`
   - Use `schema.safeParse()` in validation functions
   - Ensures frontend/backend validation parity

5. **Add `serverError` prop to all delete dialogs**
   - DeleteStationDialog, DeletePortalDialog, DeleteTagDialog currently have no error display
   - Users get no feedback when delete operations fail

6. **Add error display to EntityGroupDetail mutations**
   - Name update, member add, and group delete all silently swallow errors

7. **Add autoFocus to CreatePortalDialog station select**

### P2 (Medium — UX Polish)

8. **Add focus management on validation failure**
   - After submit validation, focus first invalid field
   - Announce error count to screen readers

9. **Add `aria-label` to all icon-only buttons**
   - Audit all IconButton components for accessible names

10. **Add maxLength to text inputs**
    - Derive from Zod schema string length constraints or DB column limits

11. **Add global Snackbar/Toast provider**
    - For errors that occur outside dialog context
    - For success confirmations on non-dialog operations

### P3 (Low — Nice to Have)

12. **Add CSVConnector step-level validation**
    - EntityStep: Validate entity keys are non-empty and unique
    - ColumnMappingStep: Validate required mappings are set

13. **Standardize error display component**
    - Create a `FormError` wrapper component that encapsulates Alert + aria-live

---

## 5. FILES REQUIRING CHANGES

### Must Change (P0 + P1)
- `apps/web/src/components/CreateStationDialog.component.tsx`
- `apps/web/src/components/EditStationDialog.component.tsx`
- `apps/web/src/components/CreatePortalDialog.component.tsx`
- `apps/web/src/components/TagFormModal.component.tsx`
- `apps/web/src/components/EditConnectorInstanceDialog.component.tsx`
- `apps/web/src/components/DeleteStationDialog.component.tsx`
- `apps/web/src/components/DeletePortalDialog.component.tsx`
- `apps/web/src/components/DeleteTagDialog.component.tsx`
- `apps/web/src/views/EntityGroupDetail.view.tsx`
- `apps/web/src/views/Stations.view.tsx` (pass serverError to delete dialogs)
- `apps/web/src/views/EntityGroups.view.tsx` (pass serverError to delete dialogs)

### Should Change (P2)
- All icon-only button components (audit needed)
- `apps/web/src/workflows/CSVConnector/EntityStep.component.tsx`
- `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`

---

## 6. CURRENT PATTERNS (For Reference)

### Manual Validation Pattern (Current)
```tsx
// Touched state per field
const [touched, setTouched] = useState<Record<string, boolean>>({});
const [errors, setErrors] = useState<Record<string, string>>({});

// Validate function
function validateForm(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Name is required";
  return errors;
}

// onBlur marks field touched
const handleBlur = (field: string) => {
  setTouched(prev => ({ ...prev, [field]: true }));
  setErrors(validateForm(form));
};

// onSubmit marks all touched + validates
const handleSubmit = () => {
  setTouched({ name: true, /* all fields */ });
  const errs = validateForm(form);
  setErrors(errs);
  if (Object.keys(errs).length > 0) return;
  onSubmit(form);
};
```

### Server Error Display Pattern (Current)
```tsx
// Parent view
<CreateStationDialog
  serverError={mutation.error?.message ?? null}
  isPending={mutation.isPending}
/>

// Inside dialog
{serverError && (
  <Typography variant="body2" color="error">{serverError}</Typography>
)}
```

### API Error Class (Current)
```tsx
// utils/api.util.ts
class ApiError extends Error {
  code: string;
  status: number;
  success: false;
}
```
