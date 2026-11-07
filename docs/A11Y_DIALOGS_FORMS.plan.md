# Accessibility: dialogs and forms — Plan

**This plan sequences the dialog and form accessibility contract as TDD slices.** It covers:
- theme-owned styling;
- `Modal`'s inner form, name and description;
- gate reasons as descriptions, with focus restored through menus;
- labelled fields and selects;
- pending buttons that keep focus;
- the axe case in every dialog test;
- the per-area one-offs.

Spec: `docs/A11Y_DIALOGS_FORMS.spec.md`. Discovery: `docs/A11Y_DIALOGS_FORMS.discovery.md`. Issue: #793 (epic #791). It builds on #792's tooling (`expectNoAxeViolations`, `a11y:report`) and #797's `a11yComponents()` layer and route announcer, all on `epic/a11y-conformance`.

There are seven slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/793-a11y-dialogs-forms` / PR #981**, so one feature is one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <file>
cd apps/web && npm run test:unit -- --testPathPattern <file>
npm run lint:a11y-inventory          # root, inventory self-test
```

**Each slice:**
1. Write failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests.
4. At the boundary, run `npm run lint && npm run type-check` in each touched package. After a core change, rebuild core before running web's type-check and tests, since web reads core's `dist`.
5. Move to the next slice.

**Sequencing rationale.** Shared sources go first, so the per-dialog sweeps at the end find nothing left to fix but the dialogs themselves:
- **Slice 1:** theme rules. Leaf styling only; the components still carry their own `sx` until slice 3 removes it, so nothing regresses.
- **Slice 2:** `Modal`. The name union forces its call sites into the same commit, and any web test that expects a disabled close button changes with it.
- **Slice 3:** gated controls, `pendingGate` and `ActionsMenu` timing. `pendingGate` has to exist before slice 5 uses it.
- **Slice 4:** fields and selects, including AdvancedFilterBuilder. They render inside dialogs, so they have to be clean before slice 6 runs axe on every dialog.
- **Slice 5:** R7 plus the pending-button sweep.
- **Slice 6:** R6 plus the axe case in every dialog test. It lands last among the code slices because it proves slices 1–5 together.
- **Slice 7:** one-offs, inventory routing, the regenerated audit and docs.

No migration, no seed.

---

## Slice 1 — Theme: subtitle mapping and the `aria-disabled` look

Styling lives in the theme (D10). This slice adds the two theme rules the rest of the ticket relies on.

**Files**

- Edit: `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json`. Add `MuiTypography.defaultProps.variantMapping` with `subtitle1`/`subtitle2` → `p`, in the same shape in both files.
- Edit: `packages/core/src/ui/ThemeProvider.tsx`. `a11yComponents()` gains function-form `[aria-disabled="true"]` overrides on `MuiButton`, `MuiIconButton` and `MuiMenuItem`, with values read from `theme.palette.action`.
- Edit: `packages/core/src/__tests__/ui/ThemeProvider.test.tsx`.

**Steps**

1. **Tests (spec: ThemeProvider, ≈ 4).**
   - In both themes, `subtitle1`/`subtitle2` render as `p`, and `h1`–`h6`/`body1` keep MUI's mapping.
   - An `aria-disabled` `Button` (contained and outlined), `IconButton` and `MenuItem` get the disabled color and cursor from the theme alone, with no `sx`.

   Run; they fail.
2. **Implement** the JSON keys, then the overrides. If a JSON `variantMapping` replaces MUI's map instead of merging, spell out the full map in both files; the test pins it. Green.
3. Rebuild core, then run lint and type-check in core and web.

**Done when:** the theme cases pass in both themes. `gatedDisabledSx` still exists, and both definitions agree.

**Risk:** some screen relied on a subtitle being a heading. The slice 7 re-walk surfaces it (`page-has-heading-one`, heading lists), and the fix is a `component="hN"` at that site.

---

## Slice 2 — `Modal`: inner form, name, description and pending close

**Files**

- Edit: `packages/core/src/ui/Modal.tsx`:
  - the `ModalName` union and `description`;
  - an inner `<form>` that keeps #789's handlers, with its layout class carrying a comment saying why it lives here;
  - an `aria-disabled` close button.
- Edit: `packages/core/src/__tests__/ui/Modal.test.tsx`.
- Edit: any `apps/web` `<Modal>` with neither `title` nor `aria-label`. Type-check finds them; each gets an `aria-label`.
- Edit: any web test asserting the close button `toBeDisabled()` while pending. It now checks `aria-disabled` and that a click does nothing.

**Steps**

1. **Tests (spec: Modal, ≈ 12).**
   - Naming by `title` and by `aria-label`, plus a `@ts-expect-error` fixture.
   - `description` → `aria-describedby`.
   - `role="dialog"` isn't a form, and there's exactly one inner form.
   - Plain mode renders no form.
   - The pending close button is `aria-disabled`, keeps focus, and doesn't call `onClose`.
   - Focus returns to the opener.
   - Axe passes in form and plain modes.

   Run; they fail. The existing #789 cases must stay green throughout.
2. **Implement** the form move first (the #789 cases are the regression net), then the naming and description, then the close button. Green.
3. Rebuild core. Run web type-check, fix the unnamed call sites, and run the web tests that mention the close button (`--testPathPattern Dialog|Modal`).
4. Lint and type-check in core and web.

**Done when:**
- the Modal cases and every #789 case pass;
- web compiles;
- no dialog renders `<form role="dialog">`.

**Risk:** layout inside the form (scrolling content, maximize/`fullScreen`, sticky actions). Spot-check the story sweep output, and the `RegionEditor` and `CuratedViewEditor` stories in Storybook, before committing.

---

## Slice 3 — Gated controls: reason as a description, `pendingGate`, menu focus

**Files**

- Edit: `packages/core/src/ui/ActionGate.ts`. Add `pendingGate`, and update the doc comment.
- Edit: `GatedButton.tsx`, `GatedIconButton.tsx`, `ActionsMenu.tsx`:
  - a visually hidden reason, with `aria-describedby`;
  - the `Tooltip` without `describeChild`;
  - `gatedDisabledSx` and the per-component `sx` deleted;
  - `ActionsMenu` running the stored action on the menu transition's `onExited`.
- Edit: their tests and `ActionGate.test.ts`.

**Steps**

1. **Tests (spec: gated controls, ≈ 12).**
   - `toHaveAccessibleDescription(reason)` on `disable` and `upsell`, without hovering.
   - The name is unchanged.
   - An `allow` control has no description.
   - No inline style comes from the component.
   - `pendingGate` returns `disable`/`allow`.
   - A menu item that opens a `Modal` leaves focus on the menu trigger after the modal closes.
   - A disabled item is still inert.
   - Axe passes for each gate kind.

   Run; they fail.
2. **Implement.** If dropping `describeChild` makes MUI name the child from a string `title`, apply the spec's fallback, which keeps the control's own name. Green.
3. Rebuild core. Run the web tests for views using gates (`--testPathPattern gates|PageHeader|ActionsMenu`); assertions that relied on `describeChild`'s timing change to the permanent description.
4. Lint and type-check in core and web.

**Done when:**
- the gate cases pass;
- `gatedDisabledSx` is gone;
- the disabled look comes only from slice 1's theme rule.

**Risk:** the tooltip naming. It's covered by the name assertions on every gate kind.

---

## Slice 4 — Fields and selects

**Files**

- Edit: `packages/core/src/ui/searchable-select/AsyncSearchableSelect.tsx`:
  - the chip id and "Selected:" prefix;
  - "Remove <label>";
  - `aria-describedby`;
  - `required` only while nothing is selected;
  - `loadingText`.
- Edit: `packages/core/src/ui/ColorPicker.tsx`. The group is named by its label, and `required`, `error`, `helperText` and `id` reach the hex field.
- Edit: `apps/web/src/components/TagFormModal.component.tsx`. Pass the error props to `ColorPicker`, and drop the caption.
- Edit: `apps/web/src/components/AdvancedFilterBuilder.component.tsx`:
  - `position`;
  - the "Condition N" group;
  - the Column/Operator/Value/Minimum/Maximum labels;
  - the "Match" group label.
- Edit: `CuratedViewEditorDialog`, `CreateStationDialog`, `CreatePortalDialog`. Their raw `Autocomplete`s get a label and `loadingText`.
- Edit: the matching tests in core and web.

**Steps**

1. **Tests (spec: selects and ColorPicker ≈ 8; web field cases from AdvancedFilterBuilder and TagFormModal).** Each component's cases pass, along with its axe case. Run; they fail.
2. **Implement**, one component at a time. Green.
3. Rebuild core. Run the web tests for consumers of `AsyncSearchableSelect` (`--testPathPattern Dialog|Select`), since any assertion that the combobox is `required` with a value set has to change.
4. Lint and type-check in core and web.

**Done when:**
- the field and select cases pass;
- AdvancedFilterBuilder's populated and max-depth fixtures pass axe;
- the `label` and `aria-input-field-name` findings are gone from this area.

**Risk:** low. The required-state change alters what a consumer test reads. Visuals are unchanged.

---

## Slice 5 — Pending buttons keep focus (R7 + sweep)

**Files**

- Edit: `apps/web/src/__tests__/dialog-contract.guard.test.ts`. Add **R7** (`disabledReadsPending`), its fixtures, `PENDING_DISABLED_EXEMPT = {}`, and an `it.each` over the real files.
- Edit: every `apps/web` `*.component.tsx` with a `<Modal pending=…>` whose action `Button` reads the pending flag (~79 buttons). Each becomes `GatedButton` with `pendingGate(isPending, …)` and keeps its other `disabled` condition. A confirm or delete dialog whose body is one sentence moves that sentence to `description` while the file is open.
- Edit: the dialogs' pending tests. `toBeDisabled()` becomes `aria-disabled="true"`, plus "clicking does nothing".

**Steps**

1. **Guard fixtures (spec: R7).** Flag `disabled={isPending}` and `disabled={isPending || !name}`, and pass `gate={pendingGate(isPending)}`. Then the `it.each` over real files. Run; it fails and lists every offending file.
2. **Sweep** file by file, updating each dialog's tests in the same pass. Rerun the guard as files come off the list.
3. Run all dialog tests in web (`--testPathPattern Dialog|Modal|Workflow`).
4. Lint and type-check in web.

**Done when:**
- R7 is green with an empty allowlist;
- every dialog test passes;
- no dialog button is `disabled` by its pending flag.

**Risk:** this is the broadest slice by file count. It's mechanical, and R7 plus each dialog's own pending test hold it. If review size becomes a problem, split it into 5a (components/) and 5b (workflows/ and views), each green.

---

## Slice 6 — Every dialog test runs axe (R6 + sweep)

**Files**

- Edit: `dialog-contract.guard.test.ts`. Add **R6** (test file ↔ component pairing by name, a `expectNoAxeViolations(` check ignoring comments), `AXE_EXEMPT = {}`, and the vacuity floor (≥ 40 paired files).
- Edit: ~53 dialog test files. Add "has no axe violations when open" using `expectNoAxeViolations(screen.getByRole("dialog"))`. For form dialogs, also run it with a `serverError` and with a validation error shown.
- Edit: whatever those cases expose. Expected leftovers are unlabelled fields in individual dialogs, fixed in place with labels; any styling goes through the theme, never `sx` in web.

**Steps**

1. **Guard fixtures (spec: R6).** Flag a missing call, pass a present one, and ignore a commented one. Then the real-file `it.each`. Run; it fails and lists every unpaired test.
2. **Sweep:** add the axe case to each test, run it, and fix what it finds in that dialog. A test that doesn't follow the naming convention gets renamed rather than allowlisted.
3. Run all dialog tests and the guard.
4. Lint and type-check in web.

**Done when:**
- R6 is green with an empty allowlist;
- every dialog's axe case passes, so the spec's ≈ 53 per-dialog cases are done.

**Risk:** a finding that traces back to a shared component missed by slices 1–4. Fix it at the source in core, add a core test, and note it in the commit.

---

## Slice 7 — One-offs, inventory routing, audit re-run and docs

**Files**

- Edit: `packages/core/src/stories/IconButton.stories.tsx` (an `aria-label`).
- Edit: `apps/web/src/components/ChatWindow.component.tsx`. Drop `autoFocus`.
- Edit: `apps/web/src/components/SsoLoginForm.component.tsx`. `autoFocus` → `useDialogAutoFocus(true)`.
- Edit: their tests: the composer isn't auto-focused, and the email field is focused after mount.
- Edit: `scripts/a11y-inventory.mjs`. Add `ROW_OWNERS` (corner header → 795) and a self-test fixture.
- Edit: `CLAUDE.md`, under Form & Dialog Pattern and the Dialog & Form Test Checklist:
  - the inner form;
  - `pendingGate` / R7;
  - the axe case / R6;
  - `description`.
- Regenerate: `docs/A11Y_AUDIT.md` via `npm run a11y:report`. This needs the dev stack and the e2e auth fixture for the browser walk.
- Edit: the epic #791 status table, noting that the theme-wide subtitle → `p` change affects #794–#796.

**Steps**

1. **Tests.** The ChatWindow and SsoLoginForm cases, plus the inventory self-test fixture (`npm run lint:a11y-inventory`). Run; they fail.
2. **Implement.** Green.
3. Run `npm run a11y:report` and check the result:
   - #793's section is empty;
   - #795 gained only the corner-header rows;
   - no other area's count rose.

   Any leftover row goes back to the slice that owns it, as a follow-up commit.
4. Root `npm run build && npm run type-check && npm run lint`. This is the last slice, so the whole tree is checked, as CI would.

**Done when:**
- the #793 section is empty;
- CLAUDE.md matches the code;
- the whole tree builds, type-checks and lints.

**Risk:** `a11y:report`'s browser walk needs a healthy local stack. If the stack is unavailable, record that, and commit the inventory only once it runs.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Theme subtitle mapping + `aria-disabled` look | ThemeProvider cases, both themes |
| 2 | `Modal` inner form, name, description, pending close | Modal + #789 cases; web compiles |
| 3 | Gate reasons as descriptions, `pendingGate`, menu focus | gate cases; `gatedDisabledSx` gone |
| 4 | ColorPicker, async select, AdvancedFilterBuilder, raw Autocompletes | field cases + their axe |
| 5 | R7 + pending-button sweep (~79) | R7 green, empty allowlist |
| 6 | R6 + axe in every dialog test (~53) | R6 green, empty allowlist |
| 7 | One-offs, inventory routing, CLAUDE.md, `a11y:report` | #793 section empty; root build green |

## Cross-slice notes

- **Core → web.** Web compiles against core's `dist`, so rebuild core at every slice boundary that touches it. A web failure in an untouched file usually means a stale `dist`.
- **Styling stays in the theme.** No slice adds accessibility styling as an `sx` in `apps/web`. The single exception is the inner form's layout class inside core's `Modal`, which carries a comment saying why.
- **Partial module mocks.** Web tests that fake `@portalai/core/ui` partially fail on a new export (`pendingGate`). Grep the fakes in slice 3 before pushing.
- **The #789 regression net.** The Enter, pending and Escape cases in `Modal.test.tsx`, plus `dialog-single-flight.integration.test.tsx`, must stay green from slice 2 on.
- **Doc sync.** CLAUDE.md lands in slice 7 with the conventions it describes. `docs/A11Y_AUDIT.md` is regenerated, never hand-edited. No Help, glossary or tool surface changes.
- **Formatting.** The pre-commit hook runs prettier on staged files. Run `npm run format:check` before pushing the large sweep slices.

## Next step

Once you've confirmed this plan, implementation begins on `feat/793-a11y-dialogs-forms` with slice 1, tests first, one commit per slice.
