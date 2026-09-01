import { formatAgo } from "../utils/relative-time.util";

const NOW = 1_800_000_000_000;

describe("formatAgo (#391)", () => {
  it("reads 'just now' under a minute", () => {
    expect(formatAgo(NOW - 5_000, NOW)).toBe("just now");
    expect(formatAgo(NOW - 59_000, NOW)).toBe("just now");
  });

  it("reads minutes between 1m and 1h", () => {
    expect(formatAgo(NOW - 60_000, NOW)).toBe("1 min ago");
    expect(formatAgo(NOW - 35 * 60_000, NOW)).toBe("35 min ago");
  });

  it("reads hours between 1h and 1d", () => {
    expect(formatAgo(NOW - 60 * 60_000, NOW)).toBe("1 h ago");
    expect(formatAgo(NOW - 23 * 60 * 60_000, NOW)).toBe("23 h ago");
  });

  it("reads days from 24h up", () => {
    expect(formatAgo(NOW - 24 * 60 * 60_000, NOW)).toBe("1 d ago");
    expect(formatAgo(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3 d ago");
  });

  it("clamps a future timestamp to 'just now' rather than going negative", () => {
    expect(formatAgo(NOW + 10_000, NOW)).toBe("just now");
  });
});
