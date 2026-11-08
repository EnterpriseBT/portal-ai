# Paginated pages' search field stops taking focus — Condensed design (#988)

**Issue:** [EnterpriseBT/portal-ai#988](https://github.com/EnterpriseBT/portal-ai/issues/988) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why.** #797's route announcer moves focus to the page's `h1` after a client-side navigation, so a screen reader announces the page. `PaginationToolbar`'s search field has `autoFocus`, which fires as the toolbar mounts, after the announcer, so on every list page focus lands in the search field instead. The field also has no accessible name, only a placeholder. Only `apps/web` is touched.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The search field | `apps/web/src/components/PaginationToolbar.component.tsx:746` | `TextField` with `autoFocus` (:747, from `bf945a5c`, which added it to dialog fields and caught this one too) and `placeholder={searchPlaceholder}` (:749). No `aria-label` or label |
| `searchPlaceholder` | `PaginationToolbar.component.tsx:678`, default "Search..." (:690) | Only `EntityDetail.view.tsx:508` overrides it, with "Search text columns" (#821) |
| Named neighbours | `PaginationToolbar.component.tsx:765`, `:1082` | "Clear search" and "Rows per page" (#793) already have names |
| Precedent | `apps/web/src/components/ChatWindow.component.tsx:292` | #793 removed the chat composer's `autoFocus` for the same reason |
| Consumers | 17 views, `AuditLogActivity`, `UsageLedgerDialog`, and a story | Every one inherits the fix. `UsageLedgerDialog` renders the toolbar inside a dialog. Without `autoFocus`, focus there starts on the dialog, and the first Tab reaches the field |
| Audit rows | `docs/A11Y_AUDIT.md:145` (`53f149ff`, jsx-a11y `no-autofocus`, generated) and `:231` (KB-02, hand-written, owner #794) | Hand-written rows close with a "**Closed:**" Observed cell (:32). Generated rows only change through `npm run a11y:report` |
| Tests | `apps/web/src/__tests__/PaginationToolbar.test.tsx:419` | Find the field by placeholder; nothing checks focus or the field's name |

## Decision — drop `autoFocus`, and name the field from a prop

- **The focus.** Remove `autoFocus` and add the #793-style comment. Nothing replaces it: search-first would need a shortcut, which nobody has asked for.
- **The name.** Options:
  - **A. `aria-label` from the placeholder.** "Search..." reads its ellipsis aloud, and a placeholder is a hint, not a label.
  - **B (chosen). A `searchLabel` prop, default "Search", passed as the input's `aria-label`.** `EntityDetail` passes "Search text columns" alongside its placeholder, so its name keeps the #821 scoping.
  - **C. A visible label.** It changes the toolbar's layout on 19 surfaces, which this bug doesn't need.
- **No lint gate here.** Making jsx-a11y `no-autofocus` an error is #799's job: it turns the report-only tools into gates. Today the rule finds only this field (`53f149ff`), so this fix clears it.

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/components/PaginationToolbar.component.tsx` (no `autoFocus`; `searchLabel` prop, default "Search", on `slotProps.htmlInput["aria-label"]`)
- Edit: `apps/web/src/views/EntityDetail.view.tsx` (`searchLabel="Search text columns"`)
- Edit: `docs/A11Y_AUDIT.md` KB-02 → "**Closed:** …". The generated `53f149ff` row clears on the next `a11y:report` run, never by hand

**Tests** (failing first; `cd apps/web && npm run test:unit -- --testPathPattern PaginationToolbar`)
- `__tests__/PaginationToolbar.test.tsx`:
  - rendering the toolbar leaves focus where it was (`document.body`);
  - the field is `getByRole("textbox", { name: "Search" })`;
  - a `searchLabel` names it ("Search text columns");
  - the snapshot updates for the new `aria-label`.
- `__tests__/EntityDetailView.test.tsx`: the records search is named "Search text columns".
- Then `npm run lint && npm run type-check && npm run format:check` in `apps/web`.

## Smoke (manual, against your dev stack)

1. Signed in, click "Stations" in the sidebar. Once the page settles, focus is on the `h1` "Stations", not the search field, and the tab title is "Stations · Portals AI".
2. Open a station, then press Back and Forward. On each page focus lands on its `h1`.
3. Press Tab from the `h1` until the search field is reached. Its accessible name (screen reader or accessibility tree) is "Search". Type a station name, and the list filters as before. "Clear search" empties it.
4. Open an entity's detail page. The records search is named "Search text columns".
5. Open Settings → "Subscription & Billing" → "Itemized usage". Focus starts on the dialog, the first Tab reaches the dialog's first control, and the search works.

## Out of scope

- A lint gate for `no-autofocus` (#799).
- A keyboard shortcut to focus search. Nobody asked for one, and it would be a new pattern.
- `#794`'s other rows (heading order on list pages).
