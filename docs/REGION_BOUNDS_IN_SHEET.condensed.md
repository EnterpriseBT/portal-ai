# A region must sit inside its sheet — Condensed design (#1008)

**Issue:** [EnterpriseBT/portal-ai#1008](https://github.com/EnterpriseBT/portal-ai/issues/1008) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Interpret takes a region hint's bounds on trust. Nothing compares them with the sheet, so:
- a hint past the last row (`B72:G5000` on the 126-row sample) or the last column (`B67:Z71` on its 8 columns) answers 200. The plan keeps the impossible bounds, and the header detector can take another table's row as the header (row 116 in the first case);
- an inverted hint (`B71:G67`) gets a misleading 400 ("no header row", since #1002's scan over rows 71→67 sees nothing). Without a header axis it reaches the final parse, whose `startRow ≤ endRow` refinement fails it as a scrubbed 500.

The editor can't draw past the sheet, so these arrive through the API, a stale `priorPlan`, or an Edit-layout re-interpret after the workbook shrank. The change is in `packages/spreadsheet-parsing` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Hint bounds | `packages/spreadsheet-parsing/src/plan/interpret-input.schema.ts:19-26` | positive integers only; no order check |
| Plan bounds | `plan/region.schema.ts:104-118` (`BoundsSchema`) | `startRow ≤ endRow`, `startCol ≤ endCol`; no dimension check (a plan has no workbook) |
| Stage 1 | `interpret/stages/detect-regions.ts:70-93` | rejects an unknown sheet (`UNKNOWN_SHEET`), then copies bounds verbatim |
| Sheet size | `workbook/types.ts` (`Sheet.dimensions`) | known to every stage, eager and lazy alike |
| Replay | `workbook/helpers.ts` (lazy `cell()`), `replay/resolve-bounds.ts:126-170` | reads past the dimensions return `undefined`, and terminator extension clamps to them, so a stored plan on a shrunken sheet replays blanks rather than failing |
| Error mapping | `apps/api/src/utils/interpret-error.util.ts:9-23` | `UNSUPPORTED_LAYOUT_SHAPE: …` → 400 with its message |

## Decision — reject out-of-sheet and inverted hints in stage 1 (400)

- **Chosen:** `detectRegions` checks each hint against its sheet once the sheet is known to exist. A hint fails if it:
  - starts after it ends, on either axis;
  - ends past the sheet's last row or column.

  Every failing hint goes into one `UNSUPPORTED_LAYOUT_SHAPE: …` error, one sentence per problem, in hint order (as #1002 does), e.g.:
  - `Region B72:G5000 on "supported_layouts" runs past the sheet's last row (126). Redraw it inside the sheet.`
  - `Region B67:Z71 on "supported_layouts" runs past the sheet's last column (H). Redraw it inside the sheet.`
  - `Region B71:G67 on "supported_layouts" starts after it ends (row 71 is below row 67). Redraw it.`

  The A1 range comes from #1002's `formatA1Range`. It throws before header detection and the model stages, so #1002's message can't misreport an inverted region, and a bad hint costs no model call.
- **Why reject, not clamp:** clamping silently changes the region the user (or their stored plan) named, and on a shrunken sheet it can quietly drop rows from a region the user believes is whole. A dynamic region (`recordAxisTerminator`) needs no clamp, since replay extends it from in-sheet bounds already.
- **Why stage 1, not the request schema:** the order check could live in `RegionHintSchema`, but the dimension check needs the workbook. One place and one message style covers both, and the request contract is unchanged.
- **Replay unchanged here:** a stored plan whose sheet later shrank already replays blanks past the last row without failing. Telling the user so, in sync feedback and Edit layout, is #1009 (split out at review: it spans the parser, the job-result contract, the API and the web).
- **Edit layout on a shrunken sheet** (confirmed): re-interpreting a stored region that now overhangs its sheet gets this 400, and the user redraws it inside the sheet.

## Plan — 1 slice

- **Files:** `interpret/stages/detect-regions.ts` (the bounds check and its error).
- **Tests (first, red):**
  - `interpret/stages/__tests__/detect-regions.test.ts` (existing):
    - past the last row, and past the last column (naming the column letters, e.g. `AB`), each throws its message;
    - an inverted hint on rows, and on columns, each throws "starts after it ends";
    - a hint ending exactly on the last row and column passes;
    - several bad hints are named in one error, in hint order;
    - an unknown sheet still throws `UNKNOWN_SHEET`;
  - `interpret/__tests__/` (end to end): the out-of-sheet and inverted hints reject with the input error, with a mock classifier never called; an inverted hint without a header axis no longer fails the final parse.
  - `npm run test:unit` in `packages/spreadsheet-parsing`; build it before the API picks it up.

## Smoke (manual, against your dev stack)

The editor can't draw past the sheet, so these use the API with a File Upload session for `supported_layouts.csv` (126 rows × 8 columns) and a row header axis. — backend

1. `B72:G5000` → 400 `… runs past the sheet's last row (126). Redraw it inside the sheet.` — backend
2. `B67:Z71` → 400 `… runs past the sheet's last column (H). …` — backend
3. `B71:G67` with a row header axis, then again with no header axis → each 400 `… starts after it ends (row 71 is below row 67). Redraw it.`, never a 500 and never "no header row". — backend
4. `B67:G71` (in the sheet) → 200, unchanged; and `A1:H126` (the whole sheet, ending exactly on its last row and column) → not refused for its bounds. — backend
5. In the wizard: draw `B67:G71`, bind it, add a row axis, Interpret. Review loads as before, with no regression for drawn regions.

## Out of scope

- The draft-commit path, which accepts a client's plan as-is: `BoundsSchema` checks order there, and replay reads blanks past the sheet.
- Warning when a stored plan's sheet shrinks under it, so its replay reads blanks: #1009.
- The editor rendering a stored region that now overhangs its sheet (#1009 adds its warning).

## Adversarial

Probes for how the bounds check breaks, against PR [#1010](https://github.com/EnterpriseBT/portal-ai/pull/1010). Backend probes post to `POST /api/layout-plans/interpret` with the signed-in user's token and a File Upload session.

### §1 — Boundary
- [ ] `A1:H126` vs `A1:H127` vs `A1:I126` on the 126 × 8 CSV sheet. — The first is accepted (not refused for bounds); the other two are refused naming the last row (126) and the last column (H). No off-by-one. — backend
- [ ] On `supported_layouts.xlsx` (several sheets of different sizes), a hint on a small sheet with bounds that fit only a larger sheet. — Refused against its own sheet's size, not the workbook's largest. — backend
- [ ] In the editor, drag a region to the very last row and column the grid shows, bind it, Interpret. — No "runs past the sheet" refusal: the editor's grid and the parser agree on the sheet's size.

### §2 — Malformed input
- [ ] Bounds of `0`, a negative number, a fraction, and `Number.MAX_SAFE_INTEGER`. — A clean 400 for each (the request schema's `LAYOUT_PLAN_INVALID_PAYLOAD`, or this check's message); never a 500. — backend
- [ ] A huge column (`endCol: 20000`). — A 400 naming the sheet's last column; the message's letters are computed without error. — backend

### §3 — Concurrency & races — N/A: pure compute in one request.

### §4 — Auth & permission boundaries / §5 — Multi-tenant isolation
- [ ] An out-of-sheet hint against an upload session the caller doesn't own (an unknown id). — A 404 before parsing: the message, and with it the workbook's size, never reaches the caller. — backend

### §6 — State & lifecycle
- [ ] Re-interpret with a `priorPlan` whose region overhangs the sheet, and a hint inside the sheet. — 200, and the returned plan uses the hint's bounds; the prior's overhang isn't adopted. — backend

### §7 — Misuse sequences
- [ ] Send the same out-of-sheet hint twice, then fix it and send it again. — The first two get the same 400; the fixed one gets 200 (nothing sticky between requests). — backend

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

### Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

### Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
