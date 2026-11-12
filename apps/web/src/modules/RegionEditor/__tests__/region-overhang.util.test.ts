import {
  fitBoundsToSheet,
  regionOverhang,
} from "../utils/region-overhang.util";

// #1009: how far a draft (0-based bounds) runs past its sheet.
const sheet = { rowCount: 80, colCount: 8 };

describe("regionOverhang", () => {
  it("is null for a region inside its sheet", () => {
    expect(
      regionOverhang({ startRow: 1, startCol: 1, endRow: 79, endCol: 7 }, sheet)
    ).toBeNull();
  });

  it("counts rows past the sheet's last row", () => {
    expect(
      regionOverhang({ startRow: 1, startCol: 1, endRow: 99, endCol: 5 }, sheet)
    ).toEqual({ rowsPast: 20, colsPast: 0, lastRow: 79, lastCol: 7 });
  });

  it("counts columns past the sheet's last column", () => {
    expect(
      regionOverhang(
        { startRow: 1, startCol: 1, endRow: 40, endCol: 10 },
        sheet
      )
    ).toEqual({ rowsPast: 0, colsPast: 3, lastRow: 79, lastCol: 7 });
  });
});

describe("fitBoundsToSheet", () => {
  it("trims the end to the sheet's last row and column", () => {
    expect(
      fitBoundsToSheet(
        { startRow: 1, startCol: 1, endRow: 99, endCol: 10 },
        sheet
      )
    ).toEqual({ startRow: 1, startCol: 1, endRow: 79, endCol: 7 });
  });

  it("leaves a region inside its sheet unchanged", () => {
    const inside = { startRow: 1, startCol: 1, endRow: 10, endCol: 3 };
    expect(fitBoundsToSheet(inside, sheet)).toEqual(inside);
  });
});
