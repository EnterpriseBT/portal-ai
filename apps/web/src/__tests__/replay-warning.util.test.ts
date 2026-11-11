import type { ReplayWarning } from "@portalai/core/contracts";

import { formatReplayWarning } from "../utils/replay-warning.util";

// #1009: one line per region the sync read past its sheet or skipped.
const base = {
  regionId: "r1",
  sheet: "Q3",
  targetEntityDefinitionId: "contacts",
};

describe("formatReplayWarning", () => {
  it("names the rows gone from the sheet", () => {
    const w: ReplayWarning = {
      ...base,
      kind: "bounds-overflow",
      bounds: { startRow: 2, startCol: 2, endRow: 100, endCol: 6 },
      sheetLastRow: 80,
      sheetLastCol: 8,
    };
    expect(formatReplayWarning(w)).toBe(
      'B2:F100 on "Q3" (contacts) runs past the sheet\'s last row (80): rows 81–100 are gone from the sheet, so their records were removed.'
    );
  });

  it("names the columns gone from the sheet", () => {
    const w: ReplayWarning = {
      ...base,
      kind: "bounds-overflow",
      bounds: { startRow: 2, startCol: 2, endRow: 50, endCol: 11 },
      sheetLastRow: 80,
      sheetLastCol: 8,
    };
    expect(formatReplayWarning(w)).toBe(
      'B2:K50 on "Q3" (contacts) runs past the sheet\'s last column (H): columns I–K are gone from the sheet, so they were skipped.'
    );
  });

  it("names both when the region runs past both", () => {
    const w: ReplayWarning = {
      ...base,
      kind: "bounds-overflow",
      bounds: { startRow: 2, startCol: 2, endRow: 100, endCol: 11 },
      sheetLastRow: 80,
      sheetLastCol: 8,
    };
    expect(formatReplayWarning(w)).toBe(
      "B2:K100 on \"Q3\" (contacts) runs past the sheet's last row (80) and last column (H): rows 81–100 and columns I–K are gone from the sheet, so they were skipped and those rows' records removed."
    );
  });

  it("says a missing sheet replayed nothing", () => {
    const w: ReplayWarning = {
      ...base,
      kind: "sheet-missing",
      bounds: { startRow: 2, startCol: 2, endRow: 40, endCol: 6 },
    };
    expect(formatReplayWarning(w)).toBe(
      'B2:F40 (contacts) was on sheet "Q3", which is no longer in the workbook, so it replayed nothing. Its records weren\'t refreshed.'
    );
  });

  it("collapses a single row or column in the range text", () => {
    const w: ReplayWarning = {
      ...base,
      kind: "bounds-overflow",
      bounds: { startRow: 2, startCol: 2, endRow: 81, endCol: 6 },
      sheetLastRow: 80,
      sheetLastCol: 8,
    };
    expect(formatReplayWarning(w)).toContain("row 81 is gone");
  });
});
