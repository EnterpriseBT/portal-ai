# Accessibility: dialogs and forms — Discovery

**Issue:** [EnterpriseBT/portal-ai#793](https://github.com/EnterpriseBT/portal-ai/issues/793) · child of epic [#791](https://github.com/EnterpriseBT/portal-ai/issues/791), blocked by #792 (its inventory is the input). Branch `feat/793-a11y-dialogs-forms`, PR'd into `epic/a11y-conformance`.

**Why this exists.** Every write in the app happens in a dialog or a form. #789 settled their keyboard contract (Enter, Escape, pending, focus on open); it said nothing about what a screen reader hears. #792's audit (`docs/A11Y_AUDIT.md` → #793) charges this area with **24 rows and 71 instances**. Most of them repeat one of a few shared causes:
- **`role="dialog"` on a `<form>`** (`aria-allowed-role`, every form dialog): `Modal`'s form mode makes the Paper itself the form.
- **Subtitles that are headings** (`heading-order`, dialogs, Settings, the FileUpload workflow): MUI's default `Typography` mapping renders `subtitle1`/`subtitle2` as `<h6>`, so a dialog's `h2` title is followed by an `h6`.
- **Unnamed filter controls** (`aria-input-field-name`, `label`): AdvancedFilterBuilder's `Select`s and value fields have no label.
- Three one-offs: an `aria-label` on a role-less div in the RegionEditor, an unnamed `IconButton` story, and two native `autoFocus`.

The audit can't see the rest. No dialog test runs the axe assertion (0 of ~53). A gated action's reason is read out only while its tooltip is open. The async select hides its selected value from the combobox. This is the ticket that makes `Modal`, the form primitives and the gated controls correct at the source, so every dialog inherits it and a test holds each one to it.

## The current shape

### Modal (`packages/core/src/ui/Modal.tsx`)

| Piece | Location | Note |
|---|---|---|
| Title | `Modal.tsx:130-171` | A `DialogTitle` holding the title and a `data-dialog-controls` box (maximize, close). MUI renders it as `h2`. |
| Labelling | MUI `Dialog.js:263-266,348-350` | MUI sets `role="dialog"` and `aria-labelledby` → the `DialogTitle` id on the Paper. **A titled dialog is already labelled.** No dialog passes `aria-describedby`. Only `ToolpackMetadataModal.component.tsx:39-45` overrides the label, with its own `h6` title. |
| Form mode | `Modal.tsx:103-120` | `onSubmit` sets the paper slot to `component: "form"` (`noValidate`, `handleOwnSubmit`, keydown). The result is `<form role="dialog">`, the `aria-allowed-role` finding. |
| Pending | `Modal.tsx:90-99,163,177` | Blocks backdrop and Escape. The close button and `FormDefaultButton` become `disabled`, which drops them out of focus. |
| Focus | — | MUI's trap and restore-to-trigger, never overridden except `disableEnforceFocus` while the Google picker loads (`GoogleSheetsConnectorWorkflow.component.tsx:489`). `Modal.test.tsx` doesn't test labelling or focus restore. |

### Form primitives

| Piece | Location | Note |
|---|---|---|
| `FormAlert` | `apps/web/src/components/FormAlert.component.tsx:13-26` | An MUI `Alert` (implicit `role="alert"`), mounted only when `serverError` is set. |
| Field wiring | `TagFormModal.component.tsx:186-222`, `RenameOrganizationDialog.component.tsx:113-123`, `CuratedViewEditorDialog.component.tsx:192-214` | `required`, `error`, `helperText` (MUI links it by `aria-describedby`) and `aria-invalid`, as the CLAUDE.md checklist requires. |
| Gaps | `TagFormModal.component.tsx:207-210` | The color error is a bare caption that nothing associates with the `ColorPicker`. |
| Utilities | `form-validation.util.ts:13-20`, `use-dialog-autofocus.util.ts:8-23`, `dialog-blur.util.ts:13-25` | Focus moves to the first `aria-invalid` field on submit. Focus on open is a 50ms effect, not `autoFocus`. |

### Selects (`packages/core/src/ui/searchable-select/`)

All six are MUI `Autocomplete`, so `role="combobox"`, `aria-expanded`, `aria-controls`, the listbox and `aria-activedescendant` come built in, named by the `TextField` label.
- `AsyncSearchableSelect.tsx:145-200` keeps the input at `value={null}` and shows the selection as a deletable `Chip` above it (148-157). The combobox therefore never exposes what's selected, and loading is an unnamed spinner.
- `InfiniteListbox.tsx:56` labels its sentinel "loading".
- Raw `Autocomplete` in web: `CuratedViewEditorDialog` (171, 227), `CreateStationDialog`, `CreatePortalDialog`.

### Action gates

`ActionGate.ts:9-11` documents `disable` as `aria-disabled`, focusable, reason in a tooltip. `GatedButton.tsx:45-59`, `GatedIconButton.tsx:19-33` and the `ActionsMenu.tsx:80-92,114-122` items wrap the control in `<Tooltip title={reason} describeChild>`. MUI sets `aria-describedby` **only while the tooltip is open** (`Tooltip.js:548`), so a screen-reader user browsing in virtual cursor mode never hears why the action is unavailable.

### Area-specific findings

| Finding | Location | Cause |
|---|---|---|
| `aria-input-field-name`, `label` | `AdvancedFilterBuilder.component.tsx:306-334, 398-569` | Column and operator `Select`s have no label. Value fields rely on `placeholder`. The AND/OR `ToggleButtonGroup` (168) has no group name. |
| `aria-prohibited-attr` | `modules/RegionEditor/SheetCanvas.component.tsx:1048-1066` | `div[data-corner-header]` carries `aria-label="Select entire sheet"` with no role. It's a pointer-only control (477, 527). |
| `button-name` | `packages/core/src/stories/IconButton.stories.tsx` | The Default story's icon button has no label. |
| `no-autofocus` | `ChatWindow.component.tsx:293`, `SsoLoginForm.component.tsx:108` | Native `autoFocus`. |
| `heading-order` | dialogs, Settings, `FileUploadConnectorWorkflow` | `subtitle1`/`subtitle2` → `h6` (MUI default `variantMapping`). The theme doesn't override it. |

### Tooling (#792/#797)

- `expectNoAxeViolations(container, {disableRules})` (`apps/web/src/__tests__/test-utils.tsx:115-130`), mirrored in core's `__tests__/axe.util.ts`. Both disable `color-contrast` and `region` under jsdom. Since #797, ~12 web shell tests call it, and **no dialog test does**.
- `npm run a11y:report` regenerates the inventory: jsx-a11y lint (report-only until #799), the story sweep (`stories.a11y.tsx`, non-asserting) and the browser walk, routed to owners by `scripts/a11y-inventory.mjs` (`OWNERS`, :53).
- `dialog-contract.guard.test.ts` parses every `<Modal>` with the TS compiler API (`findModals`, :91-128) and enforces R1–R5, each with fixture self-tests and a vacuity floor.

## The design space

### Decision 1 — The form inside a dialog

**A.** The Paper stays a `div` with `role="dialog"`. In form mode, `Modal` renders an inner `<form>` around the title, content, actions and `FormDefaultButton`, styled as a flex column (`display: contents` or `flex: 1`) so maximize and scroll layout don't change. The form's handlers move with it unchanged.

**B.** Keep the Paper as the form and drop `role="dialog"` from it, moving the role to a wrapper.

| | A | B |
|---|---|---|
| Valid ARIA | yes | yes, but MUI puts `role`/`aria-labelledby` on the Paper itself |
| Fights MUI | no | overrides MUI's own dialog semantics |
| Enter / pending / `handleOwnSubmit` (#789) | untouched | untouched |

**Lean: A.** It is one element in one file. The #789 behavior tests in `Modal.test.tsx` cover the move. CLAUDE.md's "`onSubmit` makes the paper the form" becomes "makes the dialog's body a form".

### Decision 2 — Naming and describing dialogs

**A.** `ModalProps` requires `title` or `aria-label` (a type-level union), so an unnamed dialog doesn't compile. A new optional `description` renders as `DialogContentText` and is wired to `aria-describedby`. Confirm and delete dialogs, whose body is a sentence, use it. Form dialogs don't need one.

**B.** Pass `aria-describedby` through per call site.

**Lean: A.** That's APG's dialog pattern: a dialog describes itself only when it has a short message to describe. `ToolpackMetadataModal` drops its hand-rolled `aria-labelledby` and `h6` title for the standard one.

### Decision 3 — Subtitles aren't headings

**A.** The core theme sets `MuiTypography.defaultProps.variantMapping` so `subtitle1`/`subtitle2` render as `p`. Places that really mean a section heading opt in with `component="h3"` (or the right level).

**B.** Fix each flagged element with `component`.

| | A | B |
|---|---|---|
| Clears every current and future subtitle `h6` | yes | only the flagged ones |
| Blast radius | every area (#794–#797 too) | this area |
| Risk | a real section heading loses its role and has to opt back in | none |

**Lean: A.** A visual style shouldn't decide document structure. The re-walk in every theme and state then shows where a heading went missing (`page-has-heading-one` and the screen-reader pass). The other children inherit this, and the epic's status table should note it.

### Decision 4 — Focus restore and pending focus

MUI's trap and restore already meet APG, with two gaps:
1. **A dialog opened from a menu item** (`ActionsMenu`, `PageHeader` secondary actions) restores focus to the item, which is gone by then, so focus lands on `body`.
2. **Pending** sets `disabled` on the focused submit and close buttons, so focus drops to `body` mid-request.

**A.** `ActionsMenu` runs the item's action after the menu has closed and returned focus to its button, so the dialog records the menu button as its trigger. During `pending`, `Modal`'s own controls and gated submits render `aria-disabled` and do nothing, rather than `disabled`.

**B.** A `returnFocusTo` ref prop on `Modal`, filled in at every call site.

**Lean: A.** It fixes both at the source with no per-dialog wiring. `submitDisabled`'s gate on Enter (#789) is unchanged.

### Decision 5 — Errors and required state

- `FormAlert` keeps MUI's `role="alert"`; a server error is announced as it appears. A test pins the role.
- Client-side errors are already announced, because `focusFirstInvalidField` moves to the field and its `helperText` is its description.
- The fix is in the custom fields: `ColorPicker` and any non-`TextField` input (selects, pickers) accept `required`, `aria-invalid` and an error id for `aria-describedby`. TagFormModal's color error uses them.

**Lean: as stated.** The pattern exists; this closes the controls that fall outside it.

### Decision 6 — The async select's selection

**A.** Show the selection in the input (standard `Autocomplete value`), dropping the chip.

**B.** Keep the chip. The combobox gets `aria-describedby` → the chip ("Selected: Acme"), and the chip's delete button is labelled "Remove Acme". Loading shows MUI's `loadingText` option, which is announced, rather than a bare spinner.

**Lean: B.** It's no visual change, and APG allows a selection rendered outside the input when it's described. The raw `Autocomplete`s in web get the same label/`loadingText` check.

### Decision 7 — A gated action's reason

**A.** Gated controls render the reason in an always-present visually hidden element with a stable id, set `aria-describedby` on the control permanently, and keep the tooltip as the visual only (no `describeChild`).

**B.** Put the reason in the accessible name ("Delete, unavailable: Sync is running").

**Lean: A.** Name and description stay separate. The reason is read out on focus and in virtual cursor mode. The change is in three core components, so every gate in the app picks it up.

### Decision 8 — Holding every dialog to it

**A.** Each dialog test (~53) calls `expectNoAxeViolations` on the open dialog, and a new guard rule **R6** in `dialog-contract.guard.test.ts` fails CI on a test of a `Modal`-rendering component (paired by file name) that doesn't call it, with an empty allowlist that only shrinks.

**B.** Make the story sweep assert for dialog stories only.

**C.** Both.

**Lean: A.** The acceptance criterion is literally "every dialog unit test runs the shared axe assertion". The guard makes that durable for the next dialog, and it fits the R5 pattern. The story sweep stays report-only until #799.

### Decision 9 — The area's one-offs

- **AdvancedFilterBuilder:** `aria-label`s naming the row ("Column, condition 2"), a value-field label, and `aria-label` on the AND/OR group.
- **IconButton story:** gets an `aria-label`.
- **SsoLoginForm:** `autoFocus` → `useDialogAutoFocus`-style effect, or a recorded disable where focus on load is the page's purpose.
- **ChatWindow composer:** same treatment, coordinated with #797's composer label.
- **The RegionEditor corner header:** see open question 1.

**Lean: as listed.**

### Decision 10 — Where styling lives

**Every styling change in this ticket lives in the theme where the theme can express it, never in an ad hoc `sx` in the app.** The theme has two homes for it:
- **The theme JSONs** (`packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json`): `defaultProps` and `styleOverrides` with literal values, kept identical in shape across both files.
- **`a11yComponents()`** (`packages/core/src/ui/ThemeProvider.tsx:47`): the layer from #797 that every theme gets whatever its JSON says. Rules that need palette values (`theme.palette.action.*`) or must hold in both themes regardless of a JSON edit go here.

The disabled-with-reason look is the case in hand. Today it's ad hoc `sx` in three core components:
- `gatedDisabledSx` (`GatedButton.tsx:18-37`), per variant;
- `GatedIconButton.tsx:28-31`;
- the `ActionsMenu.tsx:88-89` items (`opacity: 0.38`).

Decision 4 would add a fourth (Modal's pending controls).

**A.** One theme rule for `[aria-disabled="true"]` in `a11yComponents()`, on `MuiButton` (per variant), `MuiIconButton` and `MuiMenuItem`: the disabled colors, no hover change and `cursor: not-allowed`. Every `aria-disabled` control then looks disabled without anyone styling it. The components drop their `sx`, and `gatedDisabledSx` is removed.

**B.** Keep the per-component `sx` and add Modal's.

| | A | B |
|---|---|---|
| One definition of "looks disabled" | yes | four copies |
| A new `aria-disabled` control | styled for free | must copy the `sx` |
| Light/dark parity | guaranteed by the shared layer | per copy |

**Lean: A.** The same rule applies to the rest of the ticket:
- **D3's subtitle mapping:** `MuiTypography.defaultProps.variantMapping` in the theme JSONs.
- **D1's inner form:** its layout (`display: flex; flex-direction: column; min-height: 0`) is a structural class inside core's `Modal`, because no MUI component owns that element. It's not an app override.
- **Hidden text:** D6's chip description and D7's reasons use core's existing `visuallyHidden` (`packages/core/src/ui/visually-hidden.ts:6`), never a hand-written clip rule.
- **New visible labels:** AdvancedFilterBuilder's take the theme's `TextField`/`InputLabel` defaults rather than sizing their own.

Where the theme genuinely can't express something, the `sx` stays in the core component with a comment saying why, and never in `apps/web`.

## Tradeoff comparison

| | D1 inner form | D2 required name + description | D3 subtitles as `p` | D4 menu trigger + `aria-disabled` | D5 custom fields | D6 described chip | D7 hidden reason | D8 axe + R6 | D10 theme-owned styling |
|---|---|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Package | core | core + web | core (theme) | core + web | core + web | core | core | web | core (theme) |
| New pattern | no | no | no | no | no | no | no | yes (R6) | no (extends #797's layer) |

## Recommendation

1. `Modal` keeps MUI's `div role="dialog"` Paper; form mode renders an inner `<form>` that wraps title, content, actions and `FormDefaultButton`, keeping #789's handlers.
2. `ModalProps` requires `title` or `aria-label`, and gains an optional `description` wired to `aria-describedby`; confirm/delete dialogs use it. `ToolpackMetadataModal` uses the standard title.
3. The core theme maps `subtitle1`/`subtitle2` to `p`; real section headings use an explicit heading `component`.
4. `ActionsMenu` fires an item's action after the menu returns focus to its button. During `pending`, Modal's controls and the submit are `aria-disabled` rather than `disabled`.
5. `FormAlert` keeps `role="alert"`. `ColorPicker` and other non-`TextField` inputs accept `required`, `aria-invalid` and an error description.
6. `AsyncSearchableSelect` describes its combobox with the selection chip, labels the chip's delete as "Remove <label>", and announces loading via `loadingText`.
7. `GatedButton`, `GatedIconButton` and `ActionsMenu` items describe themselves by a permanent visually hidden reason; the tooltip is visual only.
8. Every dialog test calls `expectNoAxeViolations` on the open dialog, enforced by guard rule R6.
9. Styling changes go in the theme: literal values in both theme JSONs, and palette-derived accessibility rules in `a11yComponents()`. The `aria-disabled` look becomes one theme rule for `MuiButton`, `MuiIconButton` and `MuiMenuItem`, replacing `gatedDisabledSx` and the per-component `sx`. Hidden text uses core's `visuallyHidden`. No accessibility styling is added as an `sx` in `apps/web`.
10. The one-offs in Decision 9 are fixed. Done means a re-run of `npm run a11y:report` leaves the #793 section empty, and a keyboard + VoiceOver/NVDA walk of create, edit and delete in each dialog family is recorded in the smoke doc.

## Open questions

1. **Who fixes the RegionEditor corner header?** The inventory routes it to #793, but the canvas is #795's. Lean: #795 does it. Give it `role="button"` with keyboard activation there, and move the row's owner in `scripts/a11y-inventory.mjs`.
2. **Does D3 belong in this ticket?** It changes heading semantics in every area. Lean: yes, it's the cause of this area's findings and is one line. Note it on the epic's status table so #794–#796 expect it.
3. **What about `aria-disabled` on a pending submit for click?** Lean: the handler no-ops while pending. Combined with `useAuthMutation`'s in-flight dedupe (#751), nothing double-submits.
4. **Must every dialog be walked by hand?** There are about 50. Lean: walk one per family (create form, edit form, confirm delete, wizard, picker dialog). The axe assertion covers the rest structurally.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because this is client-side presentation. Lean (correctness): #789's submit gating and #751's dedupe are unchanged, and pinned by the existing `Modal` tests.
- **Accuracy & auditability:** Lean: `docs/A11Y_AUDIT.md` stays the record of truth; this ticket empties its #793 section, which feeds #800's ACR.
- **Failure modes:** Lean: fail-safe. A dialog without a name is a type error; a dialog test without axe fails R6. Nothing at runtime depends on assistive tech being present.
- **Scale & unbounded growth:** N/A because nothing grows with data. R6's cost is one axe run per dialog test.
- **Multi-tenancy:** N/A because a gate's reason and errors already pass through `serverErrorMessage` and `jobLockReason`, which name no other tenant's data.
- **Contract stability:** Lean: a new dialog inherits labelling, the form, focus and gate reasons from core, and R6 makes it prove it.
- **Data lifecycle:** N/A because nothing is stored.

## What this doesn't decide

- Dialog Enter/Escape/pending semantics (done in #789).
- Tables and pagination (#794), the RegionEditor canvas (#795, see open question 1), charts and maps (#796), the shell (#797).
- Folding jsx-a11y into the main lint and making the story sweep assert (#799).

## Next step

`docs/A11Y_DIALOGS_FORMS.spec.md` pins each contract: `ModalProps` (name union, `description`), the form element's markup, the theme mapping, the `ActionsMenu` timing, the gated-control description, the async-select ARIA, and guard R6. `docs/A11Y_DIALOGS_FORMS.plan.md` then slices about six TDD commits:
1. theme: subtitle mapping in both JSONs, and the `aria-disabled` rule in `a11yComponents()` (core);
2. `Modal` form + naming + pending focus (core);
3. gate reasons and `ActionsMenu` focus, dropping their `sx` for the theme rule (core);
4. selects and custom fields (core + web);
5. axe in every dialog test + R6 (web);
6. the one-offs, a re-run of `a11y:report`, and the walk.
