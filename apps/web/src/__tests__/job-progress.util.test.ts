import { formatJobProgress } from "../utils/job-progress.util";

// #458 — one helper owns the three display cases so the toast, the job
// detail view, and the job cards can't drift apart.

describe("formatJobProgress", () => {
  it("renders a fraction with a derived bar value when a total is known", () => {
    const display = formatJobProgress({ processed: 123954, total: 397960 }, 0);
    expect(display).toEqual({
      kind: "fraction",
      barValue: 31,
      label: "123,954 of 397,960 records",
    });
  });

  it("caps the derived bar at 99 until an asserted terminal percent", () => {
    const display = formatJobProgress({ processed: 397960, total: 397960 }, 31);
    expect(display.kind).toBe("fraction");
    if (display.kind === "fraction") {
      expect(display.barValue).toBe(99);
    }
  });

  it("lets an asserted 100 percent complete the fraction bar", () => {
    const display = formatJobProgress(
      { processed: 397960, total: 397960 },
      100
    );
    if (display.kind === "fraction") {
      expect(display.barValue).toBe(100);
    } else {
      throw new Error("expected fraction");
    }
  });

  it("renders a count with no percent when the total is unknown", () => {
    const display = formatJobProgress({ processed: 123954, total: null }, 0);
    expect(display).toEqual({
      kind: "count",
      label: "123,954 records so far",
    });
  });

  it("falls back to the plain percent when there is no detail", () => {
    const display = formatJobProgress(null, 42);
    expect(display).toEqual({ kind: "percent", barValue: 42, label: "42%" });
  });
});
