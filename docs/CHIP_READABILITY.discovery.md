# Region Review Card — Chip Readability — Discovery

## Goal

Make the binding-chip strip in the review-step `RegionReviewCardUI` scannable when a region carries many fields (think 20–50 columns). Today the strip is a flat `Stack` with `flexWrap` rendering chips in `region.columnBindings` array order — parser-determined, not alphabetical, no grouping by status, no name search. Finding a specific field requires visually walking a wrapping mosaic; spotting unmapped/invalid bindings depends on noticing colored borders among look-alikes.

Three small, additive changes to the same component:

1. **Sort chips** by status (invalid → unbound → bound alphabetical → excluded), so problems float to the top and the bulk of bindings read in a predictable order.
2. **Add an inline filter input** that case-insensitively substring-matches `source` and target `columnDefinitionLabel`. Shown only when chip count exceeds a threshold (~8) so small regions stay uncluttered.
3. **Lead each chip with a status icon** (`✓` bound / `!` invalid / `○` unbound / strikethrough excluded) so a single visual axis on the left of every chip carries status. Border becomes neutral; confidence-band tinting either becomes a subtle background detail or drops entirely.

After this change: a 30-field region renders with problems at the top, an alphabetical body underneath, and a one-keystroke filter for jumping to a known field name. The chip aesthetic, the click-to-edit semantics, and the warnings/identity panels around the strip are unchanged.

Out of scope:

- Replacing chips with a table layout. Different visual language; ripples to the cloud-spreadsheet workflows that share this card.
- Sectioned card with a separate "Issues" / "Fields" / "Excluded" hierarchy. More structure than the bug requires; can layer on later if real workbooks consistently want it.
- Sort-key dropdown (alphabetical / position / type / confidence). One sort order is enough to fix the readability complaint; configurability is hypothetical.
- Toggle-pill status filter (`[All] [Bound] [Unbound] [Invalid] [Excluded]`). Pairs well with the text filter conceptually, but adds another control row before we know the text filter alone is insufficient. Reconsider as a follow-up if user feedback says so.
- Virtualization / scrollable inner container. Even at 50 chips the strip is a few hundred px tall after wrapping; not worth the layout complexity.
- Saving filter state across renders or across regions. Local component state, lost on collapse — that's fine; the filter is a transient lookup tool, not a persisted view.

---

## Existing State

### Where the chips are rendered

`apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx:337-432`. The render block is gated on `chips.length > 0` and uses a single `<Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>` containing one `<Box component="button" ...>` (interactive) or `<Box role="status" ...>` (display-only) per chip. Chip inner JSX is `<Typography source>{...}</Typography> → <Typography target>{...}</Typography> {pill or dot}`.

### Where the chip array is built

`buildChips(region, bindingErrors, onEditBinding, resolveColumnLabel)` at `RegionReviewCard.component.tsx:103-243` walks four sources and pushes a `ReviewChip` for each:

1. Every `region.columnBindings[i]` — by-header-name and by-position locators.
2. Every pivot segment with `kind: "pivot"` on either axis (renders the axis-name slot).
3. Every entry in `region.intersectionCellValueFields` (2D crosstabs only).
4. The region-level `cellValueField` when no intersection overrides exist.

Order is deterministic but parser-driven: bindings first in their array order, pivots in axis-then-segment-index order, intersections in object-key order, then the cell-value fallback. No alphabetical guarantee.

Each chip carries the fields the new behavior needs — `source`, `columnDefinitionLabel`, `excluded`, `invalid`, `band` — without a schema change. Sorting and filtering are pure transforms over the existing `ReviewChip[]`.

### What status is encoded today, and how

`RegionReviewCard.component.tsx:357-369` paints the chip border via `CONFIDENCE_BAND_PALETTE[chip.band]` (green/amber/red) for valid chips and `error.main` for invalid; lines 381-404 render an "Excluded" outlined pill, an "Invalid" / "Unbound" error pill, or a 6×6 colored dot. So the four states (bound, unbound, invalid, excluded) are encoded as a mix of border color, background tint, pill, dot, opacity, and strikethrough — five visual channels, no single axis a user can scan.

### Consumers of `RegionReviewCardUI`

The card is rendered exclusively by `ReviewStepUI` at `apps/web/src/modules/RegionEditor/ReviewStep.component.tsx:571`. `ReviewStepUI` is consumed by every connector workflow that imports the `RegionEditor` module — file-upload, Google Sheets, Microsoft Excel. The change is module-internal: every consumer benefits without touching their workflows.

### Tests already covering the chip strip

`apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard*.test.tsx` (and stories under `stories/`) exercise the chip render, click-to-edit dispatch, excluded styling, and invalid-pill behavior. New behavior — sort order, filter input, status icon — needs its own test cases without breaking these.

---

## Approach

Three changes, all inside `RegionReviewCard.component.tsx`. No prop change at the module surface. No change to consumers.

### 1. Sort

A small comparator inside (or just outside) `buildChips`:

```
priority(chip) =
  chip.invalid && !chip.excluded                  ? 0  // invalid floats first
  chip.band === "red" && !chip.invalid && !excl   ? 1  // unbound (red band, no invalid pill)
  !chip.excluded                                  ? 2  // bound — sort alphabetically by source
  excluded                                        ? 3  // excluded last
```

Within priority 2, sort by `source` localeCompare. Priorities 0/1/3 also sort alphabetically inside their bucket so the order is fully deterministic.

Rationale: invalid is *worse* than unbound (a wrong binding is more dangerous than a missing one). Excluded last because the user has explicitly said "don't bother me about this one."

### 2. Filter

A small `useState<string>("")` inside `RegionReviewCardUI`. When `chips.length > FILTER_THRESHOLD` (provisional 8), render a one-line `<TextField size="small" placeholder="Filter fields…" />` above the chip strip. Filter applies to a chip when:

```
filter.trim() === "" ||
  chip.source.toLowerCase().includes(filter.toLowerCase()) ||
  (chip.columnDefinitionLabel ?? chip.columnDefinitionId ?? "").toLowerCase().includes(filter.toLowerCase())
```

When the filter is active and yields zero matches, render a one-line "No fields match." muted hint instead of an empty strip. The filter input does not persist across collapses or re-renders driven by upstream prop changes — it's a transient lookup tool keyed on the card's identity.

The `> 8` threshold is provisional. The discovery anticipates one decision point in the spec phase to either lock in 8 or drop the threshold entirely (always show the filter input). Recommend the threshold; an empty input on every region adds visual weight regions with three chips don't need.

### 3. Leading status icon

Replace the current border-color + pill + dot encoding with a leading `<Icon>` on the left of every chip:

| State | Icon | Color | Notes |
|---|---|---|---|
| Bound (valid) | check-circle (filled) | success.main | Replaces the existing 6×6 dot. |
| Unbound | circle-outline | warning.main | Replaces the "Unbound" pill. |
| Invalid | exclamation-triangle | error.main | Replaces the "Invalid" pill. |
| Excluded | minus-circle | text.disabled | Combined with line-through and opacity, as today. |

The chip border drops to neutral (`divider`). Confidence-band tinting is preserved as a subtle background tint (low-saturation amber for amber, low-saturation red for red on bound chips that scored low) — or dropped entirely; spec phase to decide. Probably drop: with the leading icon carrying state, the band tint is double-encoding and visual noise.

The icon column gives the user one visual axis to scan: a vertical run of leading icons down the wrapped chip strip. Combined with sort, problems are immediately visible at the top-left corner of the strip.

### Why one component, no module-surface change

The chip strip is local to one card. Sort + filter + icon are pure render transforms on existing data; nothing about the consumer's wiring needs to know. Three connector workflows benefit transitively without coordinating release.

If a future workstream wants to surface "issues across all regions" at the top of the review step, that's a different concern at a different layer — the `ReviewStep` orchestrator could aggregate `chip.invalid || chip.band === "red"` counts and render a banner. Out of scope here; the in-card improvements stand alone.

---

## Decision points for the spec phase

1. **Filter threshold.** `> 8` is the working draft. Alternatives: always show; `> 12`; `> N` configurable per consumer. Recommend the spec lock in `> 8` and skip configurability.
2. **Confidence-band tint after icon lands.** Keep as subtle background tint, or drop. Recommend drop — leading icon already carries the actionable info (bound vs. not), and confidence is editable behind the click anyway.
3. **Filter scope.** Substring match on `source` + `columnDefinitionLabel` is the working draft. Whether to also match `columnDefinitionId` (the slug, e.g. `email_address`) is a spec call. Recommend yes — it's free and helps power users who think in slugs.
4. **Empty-state copy.** "No fields match." is the draft. Keep it terse; this is a card-internal hint, not a top-level empty state.
5. **Sort priority for "unbound" detection.** The working rule is `band === "red" && !invalid && !excluded`. Pivot/intersection chips synthesize their own band as `id ? "green" : "red"`, so this catches them. Spec to verify with a test fixture covering each chip-type-with-each-state combination.
6. **Icon library.** The card already imports `MuiChip`; the file uses Box + Typography. The repo's `@portalai/core/ui` exposes an `Icon` component (used elsewhere in the editor). Use it for consistency. Spec to enumerate the four `IconName` enum entries needed.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Filter input adds noise to small regions. | Threshold-gated (`> 8` chips). Small regions render unchanged. |
| Sort changes test fixtures that asserted index-based chip order. | Audit `RegionReviewCard*.test.tsx` and `stories/` for chip-order assertions. Convert to "find by text/role" assertions if any pin position; otherwise update expected sequences. |
| Stories with hand-constructed `chip.band` palettes look different after the band tint drops. | Stories render against the new look; visual delta is the point. Update story snapshots or reference screenshots. |
| Status icons read as decoration, not as actionable state. | The icons are color-coded *and* shape-coded (check vs. exclamation vs. circle). `aria-label` on each chip already names the state ("Excluded — click to edit", "Invalid — click to edit", etc.); the icon only echoes that. Screen readers don't regress. |
| Per-region filter state is lost when the card unmounts (e.g. collapse a card and reopen). | Acceptable. The filter is a transient lookup tool; persisting it would surprise users more than help them. Card-internal `useState`; no upstream wiring. |
| Click-to-edit hit area shrinks if we add an icon column in the same fixed-width chip. | Inverse — leading icon makes the chip wider, hit area grows. The button element wraps both icon and text. |
| Sort hides the "natural" order which sometimes maps to spreadsheet column order. | True for `byPositionIndex` bindings, less so for `byHeaderName` / pivot. The natural order has never been alphabetical anyway, and the readability win at scale outweighs the loss for power users who already know their column positions. Spec phase can offer a "sort: position | name" toggle as a follow-up if feedback says so. |

---

## Files anticipated touched

- Edit: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx` — sort comparator inside or outside `buildChips`; filter `useState` + `<TextField>` in `RegionReviewCardUI`; replace border/pill/dot status encoding with a leading icon column.
- Edit: `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard*.test.tsx` — new cases covering sort order, filter behavior (hidden under threshold, visible above, matches/no-match), leading-icon presence per status. Audit existing cases for chip-order assertions and update.
- Edit (possibly): `apps/web/src/modules/RegionEditor/stories/*.stories.tsx` — fixtures that produce small chip counts continue to render without the filter input; fixtures with large counts get the filter visible. Verify story output matches the new visual language.

No prop change at the `RegionReviewCardUI` or `ReviewStepUI` surface. No change to consumers (file-upload, Google Sheets, Microsoft Excel workflows). No DB / API / contract change. No new dependency.
