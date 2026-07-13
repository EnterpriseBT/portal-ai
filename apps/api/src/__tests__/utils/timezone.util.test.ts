import { describe, it, expect } from "@jest/globals";

const { isValidIanaTimezone, formatIsoWithOffset } =
  await import("../../utils/timezone.util.js");

describe("isValidIanaTimezone", () => {
  it("accepts a real IANA name (America/Los_Angeles)", () => {
    expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
  });

  it("accepts a real IANA name (Europe/London)", () => {
    expect(isValidIanaTimezone("Europe/London")).toBe(true);
  });

  it("accepts UTC", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it("rejects a fabricated IANA-shaped string", () => {
    expect(isValidIanaTimezone("Mars/Olympus")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidIanaTimezone("")).toBe(false);
  });

  it("rejects a free-text non-IANA value", () => {
    expect(isValidIanaTimezone("not a real tz")).toBe(false);
  });
});

describe("formatIsoWithOffset", () => {
  it("renders PDT offset for America/Los_Angeles in June", () => {
    expect(
      formatIsoWithOffset(
        new Date("2026-06-01T18:47:05Z"),
        "America/Los_Angeles"
      )
    ).toBe("2026-06-01T11:47:05-07:00");
  });

  it("renders PST offset for America/Los_Angeles in December (DST-aware)", () => {
    expect(
      formatIsoWithOffset(
        new Date("2026-12-01T18:47:05Z"),
        "America/Los_Angeles"
      )
    ).toBe("2026-12-01T10:47:05-08:00");
  });

  it("renders UTC as +00:00", () => {
    expect(formatIsoWithOffset(new Date("2026-06-01T18:47:05Z"), "UTC")).toBe(
      "2026-06-01T18:47:05+00:00"
    );
  });

  it("renders BST offset for Europe/London in June", () => {
    expect(
      formatIsoWithOffset(new Date("2026-06-01T18:47:05Z"), "Europe/London")
    ).toBe("2026-06-01T19:47:05+01:00");
  });

  it("round-trips: new Date(formatted).getTime() equals input.getTime()", () => {
    const cases: Array<[string, string]> = [
      ["2026-06-01T18:47:05Z", "America/Los_Angeles"],
      ["2026-12-01T18:47:05Z", "America/Los_Angeles"],
      ["2026-06-01T18:47:05Z", "UTC"],
      ["2026-06-01T18:47:05Z", "Europe/London"],
    ];
    for (const [iso, tz] of cases) {
      const d = new Date(iso);
      expect(new Date(formatIsoWithOffset(d, tz)).getTime()).toBe(d.getTime());
    }
  });
});
