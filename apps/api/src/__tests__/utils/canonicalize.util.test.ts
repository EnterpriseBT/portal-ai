import { jest, describe, it, expect } from "@jest/globals";

// Mock logger to suppress output and verify warning
const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

const { canonicalizeString } = await import("../../utils/canonicalize.util.js");

// ── canonicalizeString ──────────────────────────────────────────────

describe("canonicalizeString", () => {
  it('lowercases with "lowercase" format', () => {
    expect(canonicalizeString("HELLO World", "lowercase")).toBe("hello world");
  });

  it('uppercases with "uppercase" format', () => {
    expect(canonicalizeString("hello world", "uppercase")).toBe("HELLO WORLD");
  });

  it('trims with "trim" format', () => {
    expect(canonicalizeString("  hello  ", "trim")).toBe("hello");
  });

  it('formats 10-digit US phone with "phone" format', () => {
    expect(canonicalizeString("(555) 123-4567", "phone")).toBe("+15551234567");
  });

  it('formats 10-digit phone without separators with "phone" format', () => {
    expect(canonicalizeString("5551234567", "phone")).toBe("+15551234567");
  });

  it('keeps raw digits for non-10-digit phone with "phone" format', () => {
    expect(canonicalizeString("+44 20 7946 0958", "phone")).toBe(
      "442079460958"
    );
  });

  it("returns value unchanged for unrecognized format", () => {
    expect(canonicalizeString("hello", "unknown_format")).toBe("hello");
  });

  it("logs a warning for unrecognized format", () => {
    mockWarn.mockClear();
    canonicalizeString("hello", "unknown_format");
    expect(mockWarn).toHaveBeenCalledWith(
      { canonicalFormat: "unknown_format" },
      expect.stringContaining("Unrecognized")
    );
  });
});
