# Accessibility: dialogs and forms — Spec

**Issue:** [EnterpriseBT/portal-ai#793](https://github.com/EnterpriseBT/portal-ai/issues/793) · **Epic:** #791 · **Discovery:** `docs/A11Y_DIALOGS_FORMS.discovery.md`

This spec pins the contract that brings every dialog and form to WCAG 2.2 AA and the APG dialog and combobox patterns. It covers:
- the `Modal` markup and props;
- the theme rules that own the new styling;
- the gated-control description;
- the async select's ARIA;
- the per-area fixes;
- guard rules R6 and R7, which hold every dialog to it.

## Key decisions (flag for review)

1. **Inner form (D1).** The Paper stays MUI's `div role="dialog"`, and form mode renders a `<form>` inside it. #789's handlers move unchanged.
2. **Named dialogs (D2).** `ModalProps` requires `title` or `aria-label`. An optional `description` is wired to `aria-describedby`.
   - Deviation from discovery: `ToolpackMetadataModal` **keeps** its `aria-labelledby`. It names the dialog by the toolpack's name without the "Built-in" chip, which is a better name than the whole title row. Only its `subtitle2` heading-order finding is fixed, through D3.
3. **Subtitles are paragraphs, app-wide (D3, Q2 confirmed).** The fix is a theme `variantMapping` in both theme JSONs. The epic status table notes it for #794–#796.
4. **Menu actions open after the menu closes (D4).** An `ActionsMenu` item's action runs once the menu has finished closing and focus is back on its button, so a dialog opened from a menu restores focus there.
5. **Pending controls stay focusable (D4, Q3 confirmed).**
   - Modal's close button is `aria-disabled` and no-ops while `pending`.
   - Each dialog's action buttons render through `GatedButton` with `pendingGate(pending)`, not `disabled={isPending}`, which is about 79 buttons.
   - Guard **R7** enforces it.
   - `submitDisabled` still gates Enter (#789), and `useAuthMutation`'s dedupe (#751) still backs a click.
6. **Gate reasons are permanent descriptions (D7).** Every disabled or upsell gate renders its reason as a `visuallyHidden` element referenced by `aria-describedby`. The tooltip becomes visual only.
7. **Theme-owned styling (D10).** The `aria-disabled` look is one rule in `a11yComponents()`, and `gatedDisabledSx` plus the per-component `sx` are deleted. No accessibility styling is added in `apps/web`.
8. **Every dialog test runs axe (D8).** Guard **R6** enforces it.
9. **RegionEditor corner header → #795 (Q1 confirmed).** The inventory re-routes it; this ticket doesn't touch `SheetCanvas`.
10. **Smoke walks one dialog per family (Q4 confirmed).** The families are create form, edit form, confirm delete, wizard and picker dialog.

## Scope

### In scope
- `packages/core`:
  - `Modal`;
  - `a11yComponents()` and both theme JSONs;
  - `GatedButton`, `GatedIconButton`, `ActionsMenu` and a new `pendingGate`;
  - `AsyncSearchableSelect`;
  - `ColorPicker`;
  - the `IconButton` story.
- `apps/web`:
  - every `Modal` call site's pending buttons;
  - every dialog test (the axe assertion);
  - `dialog-contract.guard.test.ts` (R6, R7);
  - `AdvancedFilterBuilder`, `TagFormModal`, `ChatWindow`, `SsoLoginForm`;
  - the raw `Autocomplete`s in `CuratedViewEditorDialog`, `CreateStationDialog` and `CreatePortalDialog`.
- `scripts/a11y-inventory.mjs`: corner-header rows route to #795.
- `docs/A11Y_AUDIT.md` (regenerated), and `CLAUDE.md`'s Form & Dialog Pattern wording.

### Out of scope
- Enter, Escape and pending semantics (#789), which are unchanged.
- The RegionEditor canvas, including the corner header (#795).
- Tables and pagination (#794), charts and maps (#796), the shell (#797).
- Making jsx-a11y and the story sweep gating (#799).

## Surface

### `Modal` (`packages/core/src/ui/Modal.tsx`)

```ts
type ModalName =
  | { title: React.ReactNode; "aria-label"?: never }
  | { title?: undefined; "aria-label": string };

interface ModalBaseProps extends Omit<DialogProps, "title" | "onClose" | "open" | "onSubmit" | "aria-label"> {
  // …existing fields unchanged…
  /** A short message the dialog is about (a confirm's sentence). Rendered as
   *  `DialogContentText` above `children`, and the dialog's `aria-describedby`. */
  description?: React.ReactNode;
}
export type ModalProps = ModalBaseProps & ModalName & (ModalFormProps | ModalPlainProps);
```

- **Labelling.** MUI's `aria-labelledby` → the `DialogTitle` id stays as it is. A caller's `aria-labelledby` still wins.
- **Description.** With a `description`, Modal generates an id (`useId`), renders `<DialogContentText id={id}>` first inside `DialogContent`, and passes `aria-describedby={id}` to `Dialog`. A caller's `aria-describedby` wins.
- **Form mode markup.** The `paperSlot` no longer sets `component`, `noValidate`, `onSubmit` or `onKeyDown`. Instead:

  ```tsx
  <Dialog …>
    <form className="PortalModal-form" noValidate onSubmit={handleOwnSubmit(…)} onKeyDown={…}>
      <DialogTitle/> <DialogContent/> <DialogActions/> <FormDefaultButton/>
    </form>
  </Dialog>
  ```

  - The handlers are the current ones verbatim. `slotProps.paper.onKeyDown` is still chained.
  - The form's layout (`display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0`) is a styled class in `Modal.tsx`, because no MUI component owns this element. The file carries a comment saying why.
  - Plain mode renders no form.
- **Pending close.** The close `IconButton` gets `aria-disabled={pending || undefined}` and `onClick={pending ? undefined : onClose}`, with no `disabled`. `FormDefaultButton` is unchanged: it's hidden and not focusable.

### Theme (`packages/core/src/ui/ThemeProvider.tsx`, `assets/themes/*.json`)

- **Both JSONs** gain:

  ```json
  "MuiTypography": { "defaultProps": { "variantMapping": {
    "subtitle1": "p", "subtitle2": "p" } } }
  ```

  The other variants keep MUI's defaults, which a JSON `variantMapping` would otherwise drop. The test pins the merged map.
- **`a11yComponents(ringColor)`** keeps its signature and adds function-form overrides that read the palette:
  - `MuiButton.styleOverrides.root`: `'&[aria-disabled="true"]'` sets `cursor: not-allowed`, `color: theme.palette.action.disabled`, `boxShadow: none`, `borderColor: action.disabledBackground`. The contained variant also gets `bgcolor: action.disabledBackground`. `&:hover` keeps the same values. This is today's `gatedDisabledSx`, moved.
  - `MuiIconButton.styleOverrides.root`: `'&[aria-disabled="true"]'` sets `cursor: not-allowed`, `color: action.disabled`, with no hover background.
  - `MuiMenuItem.styleOverrides.root`: `'&[aria-disabled="true"]'` sets `cursor: not-allowed`, `opacity: theme.palette.action.disabledOpacity`.
- **Removed:** `gatedDisabledSx` (`GatedButton.tsx:18-37`), the `sx` in `GatedIconButton.tsx:28-31` and `ActionsMenu.tsx:88-89`. The `disableRipple` props stay; they're behavior, not style.

### Gated controls (`GatedButton.tsx`, `GatedIconButton.tsx`, `ActionsMenu.tsx`, `ActionGate.ts`)

- **Reason markup.** A `disable` or `upsell` gate renders the control with `aria-describedby={reasonId}` (`useId`, merged with any caller value), plus a sibling `<Box component="span" id={reasonId} sx={visuallyHidden}>{gate.reason}</Box>`.
- **Tooltip.** `Tooltip` is kept for sight, **without `describeChild`**, and with `title={gate.reason}`.
  - MUI's `title`-as-name fallback must not apply. The tooltip's child keeps its own accessible name, which is asserted in tests.
  - If MUI still sets `aria-label` from a string `title`, the implementation passes `slotProps.popper` content as a node, so the name never changes.
- **Upsell.** The reason is described the same way.
- **`pendingGate`** (new export in `ActionGate.ts`):

  ```ts
  export const pendingGate = (pending: boolean, reason = "Saving…"): ActionGate =>
    pending ? { kind: "disable", reason } : { kind: "allow" };
  ```
- **`ActionGate.ts` doc comment.** It says "reason as its description (and tooltip)".
- **`ActionsMenu` timing.** `onClick` stores the item's action in a ref and closes the menu. `MuiMenu`'s `slotProps.transition.onExited` runs and clears it. The menu's own focus restore returns focus to the trigger first, so a dialog opened by the action records the trigger as its return target. The disabled/upsell branch is unchanged. Upsell's `onUpgrade` takes the same deferred path.

### Dialog call sites (`apps/web`, every file rendering `<Modal`)

- Every action button whose `disabled` reads the `pending` identifier becomes a `GatedButton`:

  ```tsx
  <GatedButton type="button" onClick={…} gate={pendingGate(isPending, "Saving…")} disabled={!isPending && <other condition>}>
  ```

  Cancel uses `pendingGate(isPending, "Wait for the save to finish")`. The label stays as it is today ("Saving...").
- Confirm and delete dialogs whose body is a single sentence pass it as `description` instead of a child `Typography`.

### Form fields

- **`ColorPicker`** (`packages/core/src/ui/ColorPicker.tsx:31-44`) adds `required?`, `error?`, `helperText?` and `id?`.
  - The root becomes `role="group"` with `aria-labelledby` → the label element, which is rendered as a `p` with an id.
  - The hex `TextField` receives `required`, `error`, `aria-invalid={error}` and `helperText`, so MUI wires `aria-describedby`.
- **`TagFormModal`** (`TagFormModal.component.tsx:198-210`) passes `required`, `error={touched.color && !!errors.color}` and `helperText` to `ColorPicker`, and deletes its own caption.
- **`FormAlert`** is unchanged. A test pins `role="alert"` and that it's inserted with its text.

### `AsyncSearchableSelect` (`packages/core/src/ui/searchable-select/AsyncSearchableSelect.tsx`)

- **Chip.** It gets `id={chipId}`. The visible chip label is unchanged.
- **Delete button.** `deleteIcon` gets `aria-label={`Remove ${label}`}`, and the delete control is focusable.
- **Combobox input.** It gets `aria-describedby={[chipId, helperTextId].filter(Boolean).join(" ")}` while a selection exists, and `required` only while nothing is selected. The `chipId` description reads "Selected: <label>" through a `visuallyHidden` prefix inside the chip.
- **Loading.** It passes `loadingText="Loading…"` and drops the custom adornment spinner. MUI's listbox shows the loading option, which is announced. The theme already names any remaining spinner.
- `MultiAsyncSearchableSelect` keeps MUI's own tags and is unchanged.

### `AdvancedFilterBuilder` (`apps/web/src/components/AdvancedFilterBuilder.component.tsx`)

- `FilterConditionEditor` gains `position: number` (index + 1), and its row is `role="group"` with `aria-label={`Condition ${position}`}`.
- The column `Select` gets `inputProps={{ "aria-label": "Column" }}` and the operator `Select` gets `{ "aria-label": "Operator" }`. They're named within the group.
- `FilterValueInput` fields get `aria-label`: "Value", or "Minimum" and "Maximum" for between. The placeholders stay.
- The combinator `ToggleButtonGroup` gets `aria-label="Match"`.

### One-offs

- **`IconButton` story** (`packages/core/src/stories/IconButton.stories.tsx`): Default gets `"aria-label": "Settings"`.
- **`ChatWindow.component.tsx:293`:** `autoFocus` is removed. Focus on arrival follows #797's route announcer, which focuses the page `h1`.
- **`SsoLoginForm.component.tsx:108`:** `autoFocus` is replaced by `inputRef={useDialogAutoFocus(true)}`. The form appears in response to "Sign in with SSO", whose button unmounts, so focus has to land somewhere.

### Guards (`apps/web/src/__tests__/dialog-contract.guard.test.ts`)

- **R6.**
  - **Scope:** a test file (`testFiles()`) whose name matches a component file in `withModals` (`<Name>.test.tsx` or `<Name>.component.test.tsx` for `<Name>.component.tsx`).
  - **Check:** it must contain `expectNoAxeViolations(`, comments ignored.
  - **Allowlist:** `AXE_EXEMPT: Record<string, string>` is empty, and only shrinks.
  - **Vacuity floor:** at least 40 paired test files.
- **R7.**
  - **Check:** inside any `<Modal>` whose `pending` attribute is an expression `P`, no JSX element named `Button` or `IconButton` may have a `disabled` attribute whose expression text contains `P`'s identifier. Its fixture flags `disabled={isPending}` and `disabled={isPending || !name}`, and passes `gate={pendingGate(isPending)}`.
  - **Allowlist:** `PENDING_DISABLED_EXEMPT` is empty.
- **The shared axe call** for a dialog is `await expectNoAxeViolations(screen.getByRole("dialog"))`. Dialogs portal out of `container`.

### Inventory (`scripts/a11y-inventory.mjs`)

- `ROW_OWNERS` (new, checked before `PATH_OWNERS`): a row whose element matches `/data-corner-header/`, or whose rule is `aria-prohibited-attr` in a story under `FileUpload…RegionDrawingStep` / `FileUploadConnectorWorkflow` `Step1_*`, goes to **795**.
- The script's self-test gains a fixture for it.

### Docs

- **`CLAUDE.md` → Form & Dialog Pattern:**
  - "`onSubmit` makes the paper the form" becomes "`onSubmit` makes the dialog's body a form".
  - A new bullet: a dialog's action buttons use `pendingGate(pending)`, never `disabled={pending}` (R7); every dialog test runs `expectNoAxeViolations` (R6); a confirm dialog's sentence is its `description`.
- **Dialog & Form Test Checklist:** adds "Has no axe violations when open (R6)".

## Migration / Seed

None. There's no schema or seed change.

## TDD test plan

Run from each package: `npm run test:unit -- --testPathPattern <file>` (core, web). Run the guard with `npm run test:unit -- --testPathPattern dialog-contract`. Run the inventory self-test with `npm run lint:a11y-inventory` (root).

### core — `packages/core/src/__tests__/ui/Modal.test.tsx`
- **Naming:** a titled dialog is named by its title; an `aria-label` dialog is named by that. A `@ts-expect-error` fixture pins that neither prop fails to compile.
- **Description:** `description` sets `aria-describedby` to its text's element, and no description means no attribute.
- **Form mode:** `role="dialog"` is not a `form`, and the dialog contains exactly one `form` holding the title, content and actions. Plain mode has no form.
- **#789 regression:** the existing Enter, pending and Escape tests pass unchanged.
- **Pending:** the close button is `aria-disabled`, keeps focus when pending flips on, and clicking it doesn't call `onClose`.
- **Focus restore:** focus returns to the opening button on close.
- **Axe:** `expectNoAxeViolations` passes for a form dialog and a plain one.

≈ 12 cases.

### core — `ThemeProvider.test.tsx`
- `subtitle1`/`subtitle2` render as `p` in both themes, and `h1`–`h6` and `body1` are unchanged.
- `a11yComponents` styles `[aria-disabled="true"]` on `MuiButton` (contained and outlined), `MuiIconButton` and `MuiMenuItem`, read from the palette.

≈ 4 cases.

### core — `GatedButton.test.tsx`, `GatedIconButton.test.tsx`, `ActionsMenu.test.tsx`, `ActionGate.test.ts`
- **Description:** `disable` and `upsell` controls are described by the reason without hovering (`toHaveAccessibleDescription(reason)`), the name is unchanged, and an `allow` control has no description.
- **No `sx`:** a `disable` control renders no inline style from the component.
- **`ActionsMenu` timing:** an item action that opens a `Modal`, then closing that modal, leaves focus on the menu trigger. A disabled item still does nothing.
- **`pendingGate`:** `pendingGate(true)` is `disable` with "Saving…", and `false` is `allow`.
- **Axe:** passes on each control in each gate.

≈ 12 cases.

### core — `AsyncSearchableSelect.test.tsx`, `ColorPicker.test.tsx`
- **Async select:**
  - with a selection, the combobox is described by "Selected: <label>" and isn't `required`;
  - the delete button is named "Remove <label>";
  - loading shows "Loading…" in the listbox;
  - axe passes.
- **ColorPicker:**
  - it's a group named by its label;
  - `required` and `error`/`helperText` reach the hex field, with `aria-invalid` and a description;
  - axe passes.

≈ 8 cases.

### web — dialog tests (~53 files)
- One case each: "has no axe violations when open", using `expectNoAxeViolations(screen.getByRole("dialog"))`. For a form dialog, it also runs with a `serverError` and with a validation error shown.
- Each pending test's assertions change from `toBeDisabled()` to `toHaveAttribute("aria-disabled", "true")`, plus "clicking does nothing".

≈ 53 new cases plus edits.

### web — `dialog-contract.guard.test.ts`
- R6 fixtures: flags a missing call, passes a present one, and ignores a commented one.
- R7 fixtures: the three above.
- `it.each` over the real files, plus the two vacuity floors.

≈ 8 cases plus the per-file rows.

### web — `AdvancedFilterBuilder.test.tsx`, `TagFormModal.test.tsx`, `SsoLoginForm.test.tsx`, `ChatWindow.test.tsx`
- **AdvancedFilterBuilder:** each condition is a group "Condition N" with a named Column, Operator and Value; between gives Minimum and Maximum; Match is named; axe passes on the populated and max-depth fixtures.
- **TagFormModal:** a color error is the picker's description, with `aria-invalid`.
- **SsoLoginForm:** the email field is focused after mount.
- **ChatWindow:** the composer isn't auto-focused.

≈ 8 cases.

### scripts — inventory self-test
- A corner-header row goes to 795.

1 case.

**Totals ≈ 106 cases** (53 of them the per-dialog axe case).

## Acceptance criteria

- [ ] A re-run of `npm run a11y:report` leaves the #793 section of `docs/A11Y_AUDIT.md` empty, and raises no other area's count except #795's (the re-routed corner-header rows).
- [ ] No dialog renders `<form role="dialog">`, and every dialog has an accessible name.
- [ ] A confirm dialog's sentence is read as its description.
- [ ] Focus returns to the trigger on close, including a dialog opened from a "More actions" menu (to the menu button).
- [ ] While a dialog saves, focus stays on the pressed button, which reads "dimmed/unavailable" with the reason "Saving…".
- [ ] A disabled gated action reads its reason on focus without hovering, and in browse mode.
- [ ] The async select announces its current selection, and its remove control is named.
- [ ] Every form field's label, required state, invalid state and error text are announced. A server error is announced as it appears.
- [ ] Every dialog test runs the axe assertion (R6), and no dialog button is `disabled` by its pending flag (R7).
- [ ] A keyboard-only walk and a VoiceOver or NVDA walk complete create, edit and delete in one dialog of each family (create form, edit form, confirm delete, wizard, picker dialog).
- [ ] There's no new `sx` for accessibility styling in `apps/web`.

## Risks & rollback

- **The inner form changes dialog layout** (scrolling, maximize, `fullScreen`). Detected by the Modal tests, the story sweep and the smoke walk of each family. Rollback reverts the Modal slice alone; #789's behavior is in the handlers, which don't change.
- **The subtitle remap drops a heading that was meant to be one.** Detected by the re-walk (`page-has-heading-one`, the heading lists in the screen-reader pass). The fix is a `component="hN"` at that site; reverting means removing two JSON keys.
- **`GatedButton` on about 79 buttons** is a broad mechanical change, held by R7 and each dialog's pending test. The visual look comes from the same theme rule as every gate, so a styling regression shows everywhere at once and is caught in the first slice.
- **Tooltip without `describeChild`** might rename a control. Tests assert names and descriptions on every gate kind.
- **Fail-mode:** fail-safe. Everything here is markup, and nothing gates on assistive tech at runtime.

## Files touched

- **core:**
  - `ui/Modal.tsx`, `ui/ThemeProvider.tsx`, `assets/themes/brand-theme.json`, `assets/themes/brand-theme-dark.json`;
  - `ui/ActionGate.ts`, `ui/GatedButton.tsx`, `ui/GatedIconButton.tsx`, `ui/ActionsMenu.tsx`;
  - `ui/searchable-select/AsyncSearchableSelect.tsx`, `ui/ColorPicker.tsx`, `stories/IconButton.stories.tsx`;
  - the tests named above.
- **web:**
  - every `*.component.tsx` rendering `<Modal` (~58) for pending buttons and descriptions, plus their tests;
  - `components/AdvancedFilterBuilder.component.tsx`, `TagFormModal.component.tsx`, `ChatWindow.component.tsx`, `SsoLoginForm.component.tsx`;
  - `CuratedViewEditorDialog`, `CreateStationDialog`, `CreatePortalDialog` (Autocomplete labels and `loadingText`);
  - `__tests__/dialog-contract.guard.test.ts`.
- **root:** `scripts/a11y-inventory.mjs`, `docs/A11Y_AUDIT.md` (regenerated), `CLAUDE.md`.

## Next step

`docs/A11Y_DIALOGS_FORMS.plan.md` slices this into about seven TDD commits on this branch:
1. theme rules;
2. `Modal`;
3. gated controls, `pendingGate` and `ActionsMenu` timing;
4. selects and `ColorPicker`;
5. R7 plus the pending-button sweep across dialogs;
6. R6 plus the axe case in every dialog test;
7. AdvancedFilterBuilder, the one-offs, the inventory routing, a re-run of `a11y:report`, and the CLAUDE.md update.
