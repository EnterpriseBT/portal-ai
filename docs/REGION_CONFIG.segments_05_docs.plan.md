# PR 5 — Documentation Rewrite

**Depends on**: PR-1 through PR-4 merged.

**Landing invariant**: docs reflect the shipped representation.
No code changes.

**Why this cut**: bundling docs with the code PRs inflates review
cost and the architecture spec needs a real rewrite (not a
paragraph append). Shipping standalone lets a documentation-minded
reviewer handle it separately from the code-heavy reviews.

## Scope

- `docs/SPREADSHEET_PARSING.architecture.spec.md` — major rewrite.
- `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` — mark v2 items as
  shipped; update the specs table.
- `docs/REGION_CONFIG.schema_replay.spec.md` — edit in place to
  match the shipped shape.
- `docs/REGION_CONFIG.interpret.spec.md` — edit in place; drop
  `enableSegmentation`; describe `detect-segments`.
- `docs/REGION_CONFIG.ui.spec.md` — align with shipped editor
  operations.
- Historical plan files (`docs/REGION_CONFIG.schema_replay.plan.md`
  etc.) stay untouched — they document what was shipped and
  shouldn't be rewritten retroactively.

Out of scope:

- Any code changes (must be zero; fail CI on unintended diffs).

## Phases

### Phase A — Architecture spec

`docs/SPREADSHEET_PARSING.architecture.spec.md`:

- Delete "Pivoted regions" as its own section.
- Delete "Crosstabs (cells-as-records)".
- Rewrite "Region segmentation (Phase 1)" into
  "## Region structure" with subsections:
  - **Header axes** — 0/1/2 entries; what each cardinality means.
  - **Segments** — discriminated union (field / pivot / skip);
    composition rules.
  - **cellValueField** — when it's required; who names it.
  - **Record generation (unified emit)** — the Cartesian-product
    loop over axes' pivot-label positions.
  - **Derived properties** — `isCrosstab`, `isPivoted`,
    `recordsAxisOf`.
- Update the "v1 declarative surface" table's `cells-as-records`
  row to describe the unified representation.
- Cross-link to `REGION_CONFIG.segments.plan.md` (the roadmap
  index) for implementation references.

### Phase B — Discovery doc

`docs/REGION_CONFIG_FLEXIBILITY.discovery.md`:

- § "Crosstab treatment" — update "v1 scope" and "v2 path" bullets.
  The v2 path (segmented crosstab) landed in PR-1..PR-3.
- § "Phasing" — note that phases 2 (heuristic) + 4 (classifier) +
  5 (flip default) all shipped without an opt-in, so phases 2+4+5
  collapse into PR-2 and PR-3 of the segments roadmap.
- § "Permutation matrix" — add a status column; mark every in-scope
  id as ✅ implemented. Mark id 8 (segmented crosstab) as ✅ (no
  longer deferred).
- § "Specs" table — add the sub-plan files as references.

### Phase C — Segment-related specs

`docs/REGION_CONFIG.schema_replay.spec.md`:

- Replace the old single-axis `positionRoles` + `pivotSegments`
  description with the unified segment-list representation.
- Update "Acceptance criteria" to reflect the actual delivered
  refinements (1–9 from the roadmap index).
- Drop the "Non-goals" bullet that deferred segmented crosstabs.

`docs/REGION_CONFIG.interpret.spec.md`:

- Drop `enableSegmentation` and the opt-in gating discussion.
- Update "New + changed stages" to the delivered stage names:
  `detect-segments`, `classify-field-segments`,
  `recommend-segment-axis-names`.
- Update "Enablement / opt-in" section to say "no opt-in; this
  is the representation".

`docs/REGION_CONFIG.ui.spec.md`:

- Align with the segment-composition editor surface that landed in
  PR-4.
- Document each segment operation (add / remove / split / convert
  / promote-to-crosstab / collapse-to-1D).
- Update any screenshots or wire-frame references to the new UI.

### Phase D — Verify no code changes

```
git diff --stat HEAD
```

Should show only `docs/*.md` files. Any code diff is unintended.

### Phase E — Link check (optional)

If the repo has a markdown-link lint command, run it:
```
npm run lint:markdown  # if defined
```

Otherwise, eyeball the cross-links in edited files (mainly: the
architecture spec references the roadmap; the discovery doc
references specs; specs reference plans).

## PR body template

Title:
```
docs: align spec + discovery + architecture docs with shipped segmentation model
```

Body:
```markdown
## Summary

Docs-only PR. Rewrites the spreadsheet-parsing architecture spec
to describe the unified segments representation shipped in PR-1..PR-4
of the segments roadmap. Closes out the v2 crosstab item in the
discovery doc; edits `schema_replay.spec`, `interpret.spec`, and
`ui.spec` in place so each matches its shipped implementation.

Historical plan files (`c1_*.plan.md`, `c2_*.plan.md`,
`schema_replay.plan.md`, `segments_01..05.plan.md`) are left as-is
so the historical record of what shipped is intact.

## Files touched

- `docs/SPREADSHEET_PARSING.architecture.spec.md` — major rewrite
- `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` — v2 close-out +
  status column in permutation matrix
- `docs/REGION_CONFIG.schema_replay.spec.md` — updated to unified
  shape
- `docs/REGION_CONFIG.interpret.spec.md` — drop opt-in language;
  match delivered stage names
- `docs/REGION_CONFIG.ui.spec.md` — reflect PR-4 editor operations

## Test plan

- [x] `git diff --stat` shows only `.md` files
- [x] Cross-links resolve
```

## Commit / PR checklist

- [ ] A architecture spec rewrite
- [ ] B discovery doc close-out
- [ ] C1–C3 segment-spec files edited in place
- [ ] D verify no code diff
- [ ] E link check (if available)
