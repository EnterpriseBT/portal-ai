# Region Review Card — Chip Readability — Spec

**Sort chips by status priority + alphabetical, add a threshold-gated filter input, and lead each chip with a status icon — all inside `RegionReviewCard.component.tsx`.**

Discovery: `docs/CHIP_READABILITY.discovery.md`. Resolved decision points (D1–D6) from the discovery's open list:

- **D1 (filter threshold):** show the filter input when `chips.length > 8`. Below threshold, the input is omitted entirely so small regions stay clean.
- **D2 (confidence-band tint after icon lands):** drop. The leading icon already carries the actionable signal; preserving the tint double-encodes and adds visual noise. Border becomes neutral (`divider`) for every chip; invalid chips keep the `error.light` background tint as the only background-color affordance.
- **D3 (filter scope):** substring match against `source`, `columnDefinitionLabel`, **and** `columnDefinitionId`. Power users who think in slugs (`email_address`) get free coverage; cost is one extra `||` clause.
- **D4 (empty-state copy):** when the filter is non-empty and no chips match, render a single muted line `"No fields match."` in place of the chip strip. No icon, no border, just one `<Typography variant="caption" color="text.secondary">`.
- **D5 (unbound-detection rule):** `chip.band === "red" && !chip.invalid && !chip.excluded`. This catches both column-binding chips (whose `band` reflects parser confidence) and pivot/intersection chips (whose `band` is synthesized as `id ? "green" : "red"` — see `RegionReviewCard.component.tsx:148, 181`). Verified by spec test plan §"Sort coverage".
- **D6 (icon library):** use `@portalai/core/ui` `Icon` + `IconName`. Concrete names: `IconName.CheckCircle` (bound), `IconName.Warning` (unbound), `IconName.Error` (invalid), `IconName.Block` (excluded). All four already exist in the enum at `packages/core/src/ui/Icon.tsx:80,157,159,155,163` — no enum change required.

After this change: a 30-field region renders chips ordered `invalid → unbound → bound (alphabetical) → excluded`, with a one-keystroke filter input above the strip, each chip leading with a colored status icon. Module-internal change; three connector workflows benefit transitively.

---

## Scope

### In scope

1. **Sort.** A `sortChips(chips: ReviewChip[]): ReviewChip[]` pure function inside `RegionReviewCard.component.tsx`, called between `buildChips(...)` and the filter step. Comparator per §"Sort behavior" below.
2. **Filter.** A local `useState<string>("")` on `RegionReviewCardUI`. When `chips.length > 8`, render a `<TextField size="small">` above the chip strip. Filter applied between sort and render. Empty-state hint when filter is non-empty and yields zero chips.
3. **Status-icon refactor.** Replace the per-chip border-color, dot, and pill encoding with a single leading `<Icon>` whose `name` and `color` are derived from the chip state. Border becomes neutral (`divider`); invalid chips keep `error.light` background; excluded chips keep their existing line-through and opacity styling.
4. **Tests.** New cases for sort order, filter visibility/behavior, and per-state icon rendering. Audit existing cases for any chip-order or pill-presence assertions that the new behavior breaks; update those.
5. **Stories.** Existing fixtures pre-/post-sort delta is the visible value — no story-data changes needed beyond verifying snapshots/screenshots match the new look.

### Out of scope

- Module-surface prop changes on `RegionReviewCardUI` or `ReviewStepUI`. The filter and sort are internal; consumers (file-upload, Google Sheets, Microsoft Excel) need no edits.
- Sort-key configurability (alphabetical / position / type / confidence). One sort order is enough.
- Toggle-pill status filter (`[All] [Bound] [Unbound] [Invalid] [Excluded]`). Possible follow-up; not in this PR.
- Sectioned card with separate "Issues" / "Fields" / "Excluded" hierarchy. Out of scope per discovery.
- Virtualization or scrollable inner container. Out of scope per discovery — even at 50 chips the wrapped strip stays a few hundred px tall.
- Persisting filter state across remounts, route changes, or region collapses.
- Changes to `IconName` enum or `Icon.tsx`. The four needed entries already exist.
- Accessibility-keyboard sort/filter shortcuts (e.g., `/` to focus the filter). Standard MUI `<TextField>` behavior is enough.

---

## Sort behavior

Pure transform over the existing `ReviewChip[]`. Comparator-driven `Array.prototype.sort` with stable order; same-priority chips break ties by `source.localeCompare(otherSource)` so the result is deterministic.

```ts
function chipPriority(chip: ReviewChip): number {
  if (!chip.excluded && chip.invalid) return 0;             // invalid first
  if (!chip.excluded && !chip.invalid && chip.band === "red") return 1; // unbound
  if (!chip.excluded) return 2;                              // bound (sort by source)
  return 3;                                                   // excluded last
}

function sortChips(chips: ReviewChip[]): ReviewChip[] {
  return [...chips].sort((a, b) => {
    const dp = chipPriority(a) - chipPriority(b);
    if (dp !== 0) return dp;
    return a.source.localeCompare(b.source, undefined, { sensitivity: "base" });
  });
}
```

Notes:

- `sensitivity: "base"` makes the alphabetical tie-break case- and accent-insensitive — `"Email"` and `"email"` and `"Émail"` cluster together rather than scattering across cases.
- `[...chips]` clones — `sort` mutates; the chip array returned by `buildChips` is freshly constructed each render, so a non-mutating sort is paranoid but cheap.
- The function is exported from the same file (not promoted to a util) because it is private to this card and never called elsewhere.

### Sort coverage

| Chip type | State | Priority |
|---|---|---|
| Column binding (by-header-name or by-position) | invalid (errors entry present, not excluded) | 0 |
| Column binding | excluded | 3 |
| Column binding | bound | 2 |
| Column binding | low-confidence "red" band but valid + non-excluded | 1 (treated as unbound bucket — these are the "unbound-by-confidence" cases the user most wants to triage) |
| Pivot segment (axis name) | unbound (no `columnDefinitionId`) | 1 |
| Pivot segment | excluded | 3 |
| Pivot segment | bound (id present) | 2 |
| Intersection cell-value field | unbound | 1 |
| Intersection cell-value field | excluded | 3 |
| Intersection cell-value field | bound | 2 |
| Region-level cell-value field (fallback) | same rules as pivot/intersection | 1 / 2 / 3 |

Test fixture covers each row of this table.

---

## Filter behavior

A single state hook on `RegionReviewCardUI`:

```ts
const [filter, setFilter] = useState("");
```

Display logic:

```ts
const sortedChips = useMemo(() => sortChips(chips), [chips]);
const showFilterInput = sortedChips.length > 8;
const trimmedFilter = filter.trim().toLowerCase();
const filteredChips = useMemo(() => {
  if (trimmedFilter === "") return sortedChips;
  return sortedChips.filter((chip) =>
    chip.source.toLowerCase().includes(trimmedFilter) ||
    (chip.columnDefinitionLabel ?? "").toLowerCase().includes(trimmedFilter) ||
    (chip.columnDefinitionId ?? "").toLowerCase().includes(trimmedFilter)
  );
}, [sortedChips, trimmedFilter]);
```

Render:

- When `chips.length === 0` → render nothing (existing behavior).
- When `chips.length > 0`:
  - If `showFilterInput` → render the `<TextField>` row above the chip strip.
  - If `filteredChips.length === 0 && trimmedFilter !== ""` → render the empty-state line in place of the chip strip.
  - Else → render the chip strip with `filteredChips`.

The `<TextField>` row:

```tsx
<TextField
  size="small"
  fullWidth
  placeholder="Filter fields…"
  value={filter}
  onChange={(e) => setFilter(e.target.value)}
  inputProps={{ "aria-label": "Filter region fields" }}
  sx={{ mb: 1 }}
/>
```

Uses MUI's `<TextField>` (not the `@portalai/core/ui` searchable-select primitives) — the input has no autocomplete behavior; it's a plain controlled text input. `placeholder` is the affordance; no surrounding label; `aria-label` carries the accessible name. No clear-button beyond the user backspacing the value — out of scope, low value.

Why not `useDeferredValue` / debounce: the filter operates on at most a few dozen chips. `String#includes` over each chip's three short strings is sub-millisecond. Debouncing adds latency the user feels for no gain.

---

## Status-icon refactor

Inner JSX of each chip changes from:

```
[bordered box] {source} → {target} [pill | dot]
```

to:

```
[neutral-border box] [icon] {source} → {target}
```

Concrete mappings:

| State | `IconName` | `color` prop / sx | Replaces |
|---|---|---|---|
| Bound (valid, non-excluded) | `CheckCircle` | `success.main` | the 6×6 colored dot |
| Unbound (band=red, no invalid pill, non-excluded) | `Warning` | `warning.main` | the "Unbound" pill |
| Invalid (`bindingErrors[locator]` present, non-excluded) | `Error` | `error.main` | the "Invalid" pill |
| Excluded | `Block` | `text.disabled` | the "Excluded" pill |

The icon renders at `fontSize: 16` (matches the chip's `fontSize: 12` text + small icon) on the left of the chip's flex layout. The arrow `→` between source and target stays.

Border + background changes:

- `borderColor` → `divider` for every chip (drop the `CONFIDENCE_BAND_PALETTE[chip.band]` mapping; drop the `error.main` override for invalid).
- `backgroundColor` stays `error.light` for invalid chips (kept as a quiet emphasis behind the icon — invalid is the only state where the chip itself draws the eye, not just the icon). Excluded chips' opacity + line-through stay. Otherwise `background.paper` as today.

The existing pills (`<MuiChip label="Excluded" .../>`, `<MuiChip label="Invalid" .../>`, `<MuiChip label="Unbound" .../>`) and the 6×6 dot `<Box>` are removed entirely. The icon is the only state affordance. Each chip's `aria-label` continues to name the state ("Excluded — click to edit: {source}", "Invalid — click to edit: {source}", "Edit binding: {source}") so screen-reader behavior does not regress.

`CONFIDENCE_BAND_PALETTE` becomes unused inside this file. Audit other importers; if no one else consumes it, delete the constant and its declaration. (Likely it's only this card and possibly its stories.)

---

## Test plan

New `describe` blocks in `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx`. Cases:

### Sort

1. **Invalid chips appear before unbound chips.** Region with one invalid binding and one unbound binding. Assert the invalid chip's text precedes the unbound chip's text in the rendered DOM order.
2. **Unbound chips appear before bound chips.** Region with one unbound + two bound. Same DOM-order assertion.
3. **Bound chips sort alphabetically by source.** Region with three bound bindings with sources `"Zip"`, `"Address"`, `"Name"`. Assert DOM order: `Address, Name, Zip`.
4. **Excluded chips appear last.** Region with bound + invalid + excluded. Assert the excluded chip's text comes after the others.
5. **Tie-break is alphabetical within priority.** Three invalid chips with sources `"C"`, `"A"`, `"B"`. Assert order `A, B, C`.
6. **Pivot and intersection chips participate in sort.** Region mixing column bindings, pivot segments, and intersection-cell-value entries with mixed states. Assert the rendered order matches the priority + alphabetical rules.

### Filter input visibility

7. **Filter input is hidden when chips.length <= 8.** Render a region with 8 chips. Assert no `aria-label="Filter region fields"` element in the DOM.
8. **Filter input is shown when chips.length > 8.** Render with 9 chips. Assert the input is present.

### Filter behavior

9. **Substring match against `source`.** With 9 chips including `"customer_email"`, type `"email"`, assert only chips whose source contains `"email"` (case-insensitive) remain.
10. **Substring match against `columnDefinitionLabel`.** With 9 chips, one of which has `columnDefinitionLabel: "Customer Email"`, type `"customer"`, assert that chip is in the filtered output regardless of its source label.
11. **Substring match against `columnDefinitionId`.** With 9 chips, one of which has `columnDefinitionId: "email_address"`, type `"email_addr"`, assert the chip survives.
12. **Empty filter returns all chips.** Type then clear; assert all 9 chips render.
13. **No-match shows the empty-state line.** Type a string that no chip matches. Assert `"No fields match."` is in the DOM and no chip elements are rendered.
14. **Filter is case-insensitive.** Type `"EMAIL"` against a chip with `source: "Customer Email"`; the chip survives.
15. **Filter respects sort order.** With a mixed-state region of 9 chips, type a substring matching three of them; assert the surviving three render in priority + alphabetical order.

### Status icon

16. **Bound chip renders `CheckCircle` icon.** Find a bound chip; assert it has the icon. Either query by `data-testid` (added to `<Icon>` per state) or by `aria-label` matching the icon's `title`. (Decide in implementation; the helper is whichever the existing repo idiom is — see test for `ConfidenceChipUI` for the canonical query approach.)
17. **Unbound chip renders `Warning` icon.**
18. **Invalid chip renders `Error` icon.**
19. **Excluded chip renders `Block` icon.**
20. **Excluded chip retains line-through styling.** Existing assertion; verify it still passes after the pill is replaced.

### Audit / regression

21. **Existing chip-click test still passes.** The test that asserts clicking a chip fires `onEditBinding(sourceLocator, anchor)` does not pin chip order; verify it survives by querying via aria-label ("Edit binding: {source}") rather than DOM index.
22. **Existing excluded-chip styling test still passes.** Excluded line-through + opacity stay; the pill is gone, but the styling lookup keys on the chip wrapper, not the pill.

If any existing case breaks because it queried by index (`screen.getAllByRole("button")[0]`), rewrite as a name-keyed query.

Run all via `cd apps/web && npm run test:unit -- RegionReviewCard` per `feedback_use_npm_test_scripts`.

---

## Stories

`apps/web/src/modules/RegionEditor/stories/ReviewStep.stories.tsx`:

- The existing fixtures render against the new look automatically — no fixture-data edit. The visual delta (sort order, filter input on long regions, leading icons) is the point.
- Add one new story (or extend an existing one) that intentionally renders a region with > 8 chips so the filter input shows up in Storybook for design review. If `region-editor-fixtures.util.ts:PROPOSED_REGIONS` doesn't already include such a fixture, build one alongside the new story.

No story-args edits beyond that. Module-internal change.

---

## Behavior on edge cases

- **Region with zero chips.** Render nothing — existing behavior preserved by the early-return on `chips.length === 0`.
- **Filter typed while chips are empty.** Not reachable: the input only renders when `chips.length > 8`. If `chips` becomes empty after a parent re-render with the filter still mounted, the chip-strip section stops rendering entirely; filter state is preserved if the card itself stays mounted.
- **All chips are excluded.** Sort puts them all in priority 3, alphabetical tie-break runs normally. Filter input shows if there are > 8.
- **Chip's `band` is undefined.** Not possible — `buildChips` always sets `band` from `confidenceBand(...)` which has a fallback. The sort comparator's `band === "red"` test simply returns false for non-red.
- **Locale-specific source labels.** `localeCompare` with `{ sensitivity: "base" }` handles diacritics and case. Not a perfect international order for every script, but predictable enough for the use case.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Existing tests pinned chip order by DOM index. | Test plan §22 explicitly verifies; if failures surface, rewrite to name-keyed queries. |
| Designers want to keep the confidence-band border tint. | The visual signal is now the icon. If feedback says the border was load-bearing, restore it as a follow-up — the file is one component, the change is a few lines. |
| Filter input feels disconnected from the chip strip on small viewports (cards are narrow on mobile). | `<TextField fullWidth>` + `mb: 1` keeps the input and the strip in the same vertical column, matching the rest of the card's stack layout. |
| `IconName.Warning` (used for unbound) reads to designers as "warning, but the data is fine" — same icon as the `WarningRowUI` warnings list at the bottom of the card. | Considered. The semantic is consistent: both surfaces flag "user attention recommended." If the visual collision becomes confusing in practice, the spec phase can swap to a different open-circle icon. Keeping `Warning` for now to avoid expanding `IconName`. |
| Removing pills loses some users' learned recognition (the `[Excluded]` pill is a visible badge). | Excluded chips still strikethrough + opacity 0.55 *and* lead with `Block` icon. The signal is stronger, not weaker; only the rendering primitive changes. |
| `CONFIDENCE_BAND_PALETTE` deleted, and a third-party importer breaks at compile time. | Audit before deleting (`grep -r CONFIDENCE_BAND_PALETTE`). If anyone else uses it, leave it; the dead-import is harmless. |

**Rollback** is reverting `RegionReviewCard.component.tsx` and the new test cases. No state to clean up. No DB / API / contract impact.

---

## Acceptance criteria

- [ ] All 22 test plan cases pass.
- [ ] Existing `RegionReviewCard.test.tsx` cases pass without modification, except where a chip-order or pill-presence assertion is rewritten to name-keyed.
- [ ] `cd apps/web && npm run test:unit -- RegionReviewCard` is green.
- [ ] `cd apps/web && npm run test:unit` (full suite) is green — three connector workflows continue to pass without changes.
- [ ] `npm run lint` and `npm run type-check` from repo root are clean.
- [ ] Storybook renders an updated fixture: the sort puts invalid + unbound chips first; the filter input appears for > 8 chips; each chip leads with the correct status icon. Manual visual check against the discovery's expected look.
- [ ] No prop additions to `RegionReviewCardUI` or `ReviewStepUI`. No file-upload / Google Sheets / Microsoft Excel workflow file edited.

---

## Files touched

- Edit: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx` — `sortChips` helper, filter `useState` + `<TextField>`, leading-icon refactor, pill/dot/border-color cleanup. Possibly delete `CONFIDENCE_BAND_PALETTE` if no other importer.
- Edit: `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx` — new `describe` blocks for sort / filter / status-icon, audit existing cases for index-keyed queries.
- Edit (possibly): `apps/web/src/modules/RegionEditor/stories/ReviewStep.stories.tsx` — add one story rendering > 8 chips so the filter input is visible in Storybook.
- Edit (possibly): `apps/web/src/modules/RegionEditor/stories/utils/region-editor-fixtures.util.ts` — add a `MANY_CHIPS_REGION` fixture if no existing fixture has > 8 chips.

No prop changes at any module surface. No DB / API / contract / SDK / parser-package change. No change to consumers (file-upload, Google Sheets, Microsoft Excel workflows).
