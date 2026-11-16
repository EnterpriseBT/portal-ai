import { dataCapNote } from "../utils/data-cap-note.util";

// #796: what the data table says when a result was cut short.

describe("dataCapNote", () => {
  it("says nothing for a result that wasn't cut short", () => {
    expect(dataCapNote(5_000, { truncated: false })).toBeUndefined();
  });

  it("names the exact total the query matched", () => {
    expect(
      dataCapNote(100_000, {
        truncated: true,
        matchedCount: 1_234_567,
        matchedCountExact: true,
      })
    ).toBe("Showing the first 100,000 of 1,234,567 rows.");
  });

  it("states a lower bound as 'at least', never the staged count twice", () => {
    expect(
      dataCapNote(50_000, {
        truncated: true,
        matchedCount: 120_000,
        matchedCountExact: false,
      })
    ).toBe("Showing the first 50,000 of at least 120,000 rows.");
  });

  it("falls back to 'more than' with no matched count", () => {
    expect(dataCapNote(100_000, { truncated: true })).toBe(
      "Showing the first 100,000 of more than 100,000 rows."
    );
  });

  it("says nothing before the first page arrives", () => {
    expect(dataCapNote(0, { truncated: true })).toBeUndefined();
  });
});
