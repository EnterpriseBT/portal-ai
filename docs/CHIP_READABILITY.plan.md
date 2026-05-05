# Region Review Card — Chip Readability — Plan

**TDD-sequenced implementation of sort + filter + leading status icon for the chip strip in `RegionReviewCard`.**

Spec: `docs/CHIP_READABILITY.spec.md`. Discovery: `docs/CHIP_READABILITY.discovery.md`.

The change is small but spans three logical concerns (sort, filter, icons). Three slices, all in the same component, sequenced so each lands behind a green test suite. Slices are mergeable in order; do not interleave.

Run tests with `cd apps/web && npm run test:unit` per `feedback_use_npm_test_scripts` — never invoke jest directly.

---

## Slice 1 — Sort

**Files**

- Edit: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx` — add `sortChips`, call it after `buildChips`.
- Edit: `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx` — new `describe("RegionReviewCardUI — chip sort", ...)` block.

**Steps**

1. **Audit existing tests for chip-order assertions.**
   - `cd apps/web && grep -nE "getAllByRole|getAllByText|chips\\[\\d|toHaveTextContent" src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx`
   - For each match, classify:
     - **Index-keyed query** (`getAllByRole("button")[0]`, etc.) — convert to name-keyed query (`getByRole("button", { name: /Edit binding: foo/i })`) before changing sort order, so the test isn't pinned to pre-sort order.
     - **Order-asserting test** (e.g., comparing two chips' relative DOM order) — leave alone if the assertion happens to match the new sort, otherwise rewrite to either match the new sort or query by name.
     - **Order-irrelevant test** (just asserts a chip exists) — leave alone.
   - Apply rewrites first, run the suite, confirm green. This pre-flight prevents Slice 1's sort change from looking like it broke unrelated tests.

2. **Write the sort tests** in a new `describe` block at the bottom of the test file, cases 1–6 from spec test plan §"Sort":
   - `it("renders invalid chips before unbound chips", ...)`
   - `it("renders unbound chips before bound chips", ...)`
   - `it("sorts bound chips alphabetically by source", ...)` — fixture with sources `"Zip", "Address", "Name"`, assert order `Address, Name, Zip` via DOM order of buttons matched by `aria-label`.
   - `it("renders excluded chips last", ...)`
   - `it("breaks ties alphabetically within a priority bucket", ...)` — three invalids with sources `"C", "A", "B"`.
   - `it("includes pivot and intersection chips in the sort", ...)` — mixed-state region.
   - For DOM-order assertions, use the pattern:
     ```ts
     const buttons = screen.getAllByRole("button");
     const labels = buttons.map((b) => b.getAttribute("aria-label"));
     expect(labels.indexOf("Edit binding: A")).toBeLessThan(
       labels.indexOf("Edit binding: B")
     );
     ```
     so the assertion is robust to other buttons (Jump, etc.) sharing the `button` role.
   - Run; verify all six fail (`sortChips` doesn't exist).

3. **Implement `sortChips` and `chipPriority`** at the top of `RegionReviewCard.component.tsx`, between `buildChips` and `RegionReviewCardUI`. Code from the spec verbatim:

   ```ts
   function chipPriority(chip: ReviewChip): number {
     if (!chip.excluded && chip.invalid) return 0;
     if (!chip.excluded && !chip.invalid && chip.band === "red") return 1;
     if (!chip.excluded) return 2;
     return 3;
   }

   function sortChips(chips: ReviewChip[]): ReviewChip[] {
     return [...chips].sort((a, b) => {
       const dp = chipPriority(a) - chipPriority(b);
       if (dp !== 0) return dp;
       return a.source.localeCompare(b.source, undefined, {
         sensitivity: "base",
       });
     });
   }
   ```

   Inside `RegionReviewCardUI`, wrap the existing `chips` in a `useMemo` that returns `sortChips(chips)`:

   ```ts
   const chips = useMemo(
     () => sortChips(buildChips(region, bindingErrors, onEditBinding, resolveColumnLabel)),
     [region, bindingErrors, onEditBinding, resolveColumnLabel]
   );
   ```

   Replace any existing call to `buildChips(...)` directly. The render walks `chips.map(...)` over the sorted array.

4. **Run the focused suite.** `cd apps/web && npm run test:unit -- RegionReviewCard`. All sort cases pass; all existing cases still pass. If existing cases break on order, fix the test (use name-keyed queries) — the production behavior is now correct.

**Done when:**

- `sortChips` and `chipPriority` exist and are used by `RegionReviewCardUI`.
- All six sort tests pass; existing tests still pass.

**Risk:** existing cases that pinned chip order by index break. Mitigated by the pre-flight audit in step 1; if any survive, fix them with name-keyed queries. The production-side change is one render path, no possibility of a downstream regression because nothing else reads chip order.

---

## Slice 2 — Filter

**Files**

- Edit: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx` — `useState` for filter, threshold-gated `<TextField>`, filtered chips memo, empty-state hint.
- Edit: `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx` — new `describe("RegionReviewCardUI — chip filter", ...)` block.

**Steps**

1. **Write the filter tests** in a new `describe` block, cases 7–15 from spec test plan §"Filter":
   - `it("hides the filter input when chips.length <= 8", ...)` — render with 8 chips, assert no `aria-label="Filter region fields"` element.
   - `it("shows the filter input when chips.length > 8", ...)` — render with 9.
   - `it("filters by source substring (case-insensitive)", ...)` — type `"email"`, assert only matching sources render.
   - `it("filters by columnDefinitionLabel", ...)` — chip with label `"Customer Email"`, type `"customer"`.
   - `it("filters by columnDefinitionId", ...)` — chip with id `"email_address"`, type `"email_addr"`.
   - `it("returns all chips when filter is cleared", ...)`
   - `it("renders \"No fields match.\" when filter has zero matches", ...)`
   - `it("filter is case-insensitive", ...)`
   - `it("filtered chips render in priority + alphabetical order", ...)`
   - **Test fixture builder:** the test file likely already has a `makeRegion(...)` helper. Extend (or add) one that produces a region with N synthetic chips of mixed states. Keep it small — a mostly-default RegionDraft with `columnBindings: [...buildN(N)]`.
   - For typing into the filter, use `userEvent.type(input, "email")` (the existing tests use `userEvent`). Query the input via `screen.getByLabelText("Filter region fields")` or `screen.getByPlaceholderText("Filter fields…")`.
   - Run; verify all nine fail (filter input doesn't exist; empty-state line doesn't exist).

2. **Implement the filter** in `RegionReviewCardUI`. Below the existing `useMemo` for sorted chips (from Slice 1), add:

   ```ts
   const [filter, setFilter] = useState("");
   const showFilterInput = chips.length > 8;
   const trimmedFilter = filter.trim().toLowerCase();
   const filteredChips = useMemo(() => {
     if (trimmedFilter === "") return chips;
     return chips.filter(
       (chip) =>
         chip.source.toLowerCase().includes(trimmedFilter) ||
         (chip.columnDefinitionLabel ?? "").toLowerCase().includes(trimmedFilter) ||
         (chip.columnDefinitionId ?? "").toLowerCase().includes(trimmedFilter)
     );
   }, [chips, trimmedFilter]);
   ```

3. **Render the filter input + empty state** above the existing chip strip. The current chip-strip block is gated on `chips.length > 0`; expand it to:

   ```tsx
   {chips.length > 0 && (
     <>
       <Divider sx={{ my: 1 }} />
       {showFilterInput && (
         <TextField
           size="small"
           fullWidth
           placeholder="Filter fields…"
           value={filter}
           onChange={(e) => setFilter(e.target.value)}
           inputProps={{ "aria-label": "Filter region fields" }}
           sx={{ mb: 1 }}
         />
       )}
       {filteredChips.length === 0 && trimmedFilter !== "" ? (
         <Typography variant="caption" color="text.secondary">
           No fields match.
         </Typography>
       ) : (
         <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
           {filteredChips.map((chip) => { ... })}
         </Stack>
       )}
     </>
   )}
   ```

   The chip-rendering inner function still walks `filteredChips.map(...)` instead of `chips.map(...)`.

4. **Add the `TextField` import.** From `@mui/material/TextField` (the rest of the codebase imports MUI inputs directly per existing patterns; check this file's existing imports and match the style).

5. **Run the focused suite.** `cd apps/web && npm run test:unit -- RegionReviewCard`. All Slice 1 + Slice 2 tests pass.

**Done when:**

- Filter input renders above the strip when `chips.length > 8`, never otherwise.
- Filter applies the substring rule against source / label / id with case-insensitive matching.
- Empty-state "No fields match." renders only when filter is non-empty and no chips survive.
- All filter tests pass; sort tests still pass.

**Risk:** the inner `<Stack>` block being conditionally inside an empty-state branch could break existing tests that asserted the chip strip's existence based on `chips.length > 0`. The new condition is `chips.length > 0 && (filteredChips.length > 0 || trimmedFilter === "")` — same outcome when no filter is applied. Tests that don't type into the filter are unchanged.

---

## Slice 3 — Leading status icon

**Files**

- Edit: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx` — replace pill / dot / border-color status encoding with a leading `<Icon>` per state.
- Edit: `apps/web/src/modules/RegionEditor/__tests__/RegionReviewCard.test.tsx` — new `describe("RegionReviewCardUI — status icon", ...)` block.
- Edit (possibly): `apps/web/src/modules/RegionEditor/stories/ReviewStep.stories.tsx` — add a > 8 chip story for design-review visibility of all three changes.
- Edit (possibly): `apps/web/src/modules/RegionEditor/stories/utils/region-editor-fixtures.util.ts` — add a `MANY_CHIPS_REGION` fixture if none exists.

**Steps**

1. **Confirm icon enum coverage.** Verify `IconName.CheckCircle`, `IconName.Warning`, `IconName.Error`, `IconName.Block` all exist in `packages/core/src/ui/Icon.tsx`. Discovery confirmed they do (lines 80, 157, 159, 155, 163). If any has been renamed at branch tip, update the spec mapping accordingly.

2. **Write the status-icon tests** in a new `describe` block, cases 16–20 from spec test plan §"Status icon":
   - `it("renders CheckCircle icon on bound chips", ...)`
   - `it("renders Warning icon on unbound chips", ...)`
   - `it("renders Error icon on invalid chips", ...)`
   - `it("renders Block icon on excluded chips", ...)`
   - `it("retains line-through styling on excluded chips", ...)` — assertion stays as-is from the existing excluded test if present, otherwise add.
   - **Query strategy:** the `Icon` component renders an MUI `<svg>` with `data-testid` derived from the icon name (verify by reading `Icon.tsx`). If no `data-testid`, query via `aria-hidden` SVG inside the chip and check its content via the icon's component name. Most pragmatic: add a `data-testid={\`chip-icon-${state}\`}` on the icon element when refactoring; tests then `screen.getByTestId("chip-icon-bound")`. Lock this in during implementation.
   - Run; verify all five fail (icons not yet rendered).

3. **Refactor the chip render block.** In `RegionReviewCard.component.tsx`, the existing `chips.map((chip) => { ... })` block contains:
   - `const sx = { borderColor: chip.invalid ? "error.main" : CONFIDENCE_BAND_PALETTE[chip.band], backgroundColor: chip.invalid ? "error.light" : "background.paper", ... }`
   - The inner JSX with the pill/dot conditional (`{chip.excluded ? <MuiChip ... /> : chip.invalid ? <MuiChip ... /> : <Box ... />}`).

   Replace with:
   ```ts
   const iconName = chip.excluded
     ? IconName.Block
     : chip.invalid
       ? IconName.Error
       : chip.band === "red"
         ? IconName.Warning
         : IconName.CheckCircle;
   const iconColor = chip.excluded
     ? "text.disabled"
     : chip.invalid
       ? "error.main"
       : chip.band === "red"
         ? "warning.main"
         : "success.main";
   const stateName = chip.excluded
     ? "excluded"
     : chip.invalid
       ? "invalid"
       : chip.band === "red"
         ? "unbound"
         : "bound";
   ```

   The chip's `sx`:
   ```ts
   const sx = {
     display: "inline-flex",
     alignItems: "center",
     gap: 0.5,
     px: 1,
     py: 0.25,
     borderRadius: 16,
     border: "1px solid",
     borderColor: "divider",
     backgroundColor: chip.invalid ? "error.light" : "background.paper",
     color: "text.primary",
     fontFamily: "inherit",
     cursor: interactive ? "pointer" : "default",
     fontSize: 12,
     opacity: chip.excluded ? 0.55 : 1,
     textDecoration: chip.excluded ? "line-through" : "none",
   } as const;
   ```

   Inner JSX:
   ```tsx
   <>
     <Icon
       name={iconName}
       sx={{ fontSize: 16, color: iconColor }}
       data-testid={`chip-icon-${stateName}`}
     />
     <Typography variant="caption" sx={{ fontWeight: 600 }}>
       {chip.source}
     </Typography>
     <span>→</span>
     <Typography variant="caption">
       {chip.columnDefinitionLabel ?? chip.columnDefinitionId ?? "—"}
     </Typography>
   </>
   ```

   Remove the `<MuiChip label="Excluded">` / `<MuiChip label="Invalid">` / `<MuiChip label="Unbound">` and the 6×6 colored `<Box>` dot. Remove the `MuiChip` import from this file if no other usage remains.

4. **Decide `CONFIDENCE_BAND_PALETTE` disposition.**
   - `cd apps/web && grep -rn "CONFIDENCE_BAND_PALETTE" src`
   - If only this file references it, delete the constant declaration and remove its import. Run type-check.
   - If anything else references it, leave it in place (dead from this file's perspective; harmless globally).

5. **Run the focused suite.** All Slice 1 + 2 + 3 tests green.

6. **Storybook verification.**
   - Open `apps/web/src/modules/RegionEditor/stories/ReviewStep.stories.tsx`.
   - If a story with > 8 chips already exists, run Storybook (`cd apps/web && npm run storybook`) and visually confirm: filter input visible, sort puts invalid + unbound first, each chip leads with a colored icon.
   - If no such story exists, build a `MANY_CHIPS_REGION` fixture in `region-editor-fixtures.util.ts` (a region with one of each state plus enough bound chips to push count > 8) and a new story rendering it. The fixture is only consumed by the story; not used in tests.

7. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Zero errors, zero warnings.

8. **Run the full apps/web unit suite.** `cd apps/web && npm run test:unit`. All 2000+ tests green; three connector workflows still pass.

9. **Manual smoke test.**
   - `npm run dev` from repo root.
   - Upload a CSV with > 8 columns through the file-upload connector. Walk to the review step.
   - Verify: chips render with leading icons; sort places any unbound chips at the top; filter input appears; typing a substring filters in place; clearing the filter restores the strip.
   - Sanity-check Google Sheets review step: same look (this is a module change, both consumers see it). For a > 8-chip region, the IdentityPanel still renders for Google Sheets (regression check from the earlier file-upload identity-lock work).

**Done when:**

- All 22 test plan cases pass (sort 6 + filter 9 + status icon 5 + audit/regression 2).
- Storybook story renders the new look correctly with > 8 chips.
- Lint + type-check clean.
- Manual smoke test confirms file-upload + Google Sheets both render the new chips correctly.

**Risks:**

- **`Icon` component doesn't accept the `sx` shape we pass.** The repo uses `Icon` widely (Empty-state in `PortalSession.component.tsx:91`, etc.); the same pattern (`<Icon name={...} sx={{ fontSize, color }} />`) should work. Verify against an existing usage during implementation if uncertain.
- **`data-testid` on `Icon` not supported.** If the `Icon` component doesn't forward arbitrary props to its rendered SVG, fall back to wrapping the `<Icon>` in a `<Box data-testid={...}>` for test queries. One-line workaround.
- **Excluded chip's combined opacity + line-through + Block icon reads as too muted to notice.** That's the desired behavior — excluded chips should fade. If feedback says otherwise post-merge, brighten the icon (`text.secondary` instead of `text.disabled`) as a one-line follow-up.

---

## Out-of-band considerations

- **No deployment coordination.** The card is rebuilt on every render; there's no cache. The change takes effect on the first review-step render after deploy.
- **No telemetry.** If we want to measure how many users use the filter input (signal that the threshold or always-show decision was right), that's a separate analytics workstream.
- **No follow-up slice planned in this PR.** The discovery flagged a possible toggle-pill status filter (`[All] [Bound] [Unbound] [Invalid] [Excluded]`) and a sort-key dropdown. Both are deferrable; ship the minimal change first.

---

## PR shape

- Branch: a new branch — suggestion `feat/region-review-chip-readability`. Not the brevity branch, not the identity-lock branch.
- Commits: three matching the slices, conventional-commits style:
  - `feat(region-editor): sort review chips by status priority then alphabetical`
  - `feat(region-editor): add threshold-gated filter input to chip strip`
  - `feat(region-editor): replace chip pill/dot/border with leading status icon`
- PR description: link the discovery + spec + plan docs. Include a before/after screenshot pair from the new Storybook story (long-region fixture). Note the readability scenarios this fixes (locating a field by name, spotting unmapped fields).
