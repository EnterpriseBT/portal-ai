import {
  DEMO_MAX_ROWS,
  DemoOrganizationCreateInputSchema,
  OrganizationUpdateRequestSchema,
} from "../organization.contract.js";

describe("DemoOrganizationCreateInputSchema (#1035)", () => {
  const parse = (name: string, rows: string) =>
    DemoOrganizationCreateInputSchema.safeParse({ name, rows });

  it("trims the name and turns rows into a number", () => {
    const result = parse("  Acme demo  ", "10000");
    expect(result.success && result.data).toEqual({
      name: "Acme demo",
      rows: 10000,
    });
  });

  it.each(["0", String(DEMO_MAX_ROWS)])("accepts rows %s", (rows) => {
    expect(parse("Acme", rows).success).toBe(true);
  });

  it.each([
    ["an empty name", "   ", "10"],
    ["a name over 120 characters", "x".repeat(121), "10"],
    ["a line break in the name", "Acme\nDemo", "10"],
    ["empty rows", "Acme", ""],
    ["fractional rows", "Acme", "1.5"],
    ["negative rows", "Acme", "-1"],
    ["rows that aren't a number", "Acme", "lots"],
    ["rows over the cap", "Acme", String(DEMO_MAX_ROWS + 1)],
  ])("refuses %s", (_label, name, rows) => {
    expect(parse(name, rows).success).toBe(false);
  });
});

describe("OrganizationUpdateRequestSchema name rule", () => {
  it("still refuses a line break (shared with the demo create input)", () => {
    expect(
      OrganizationUpdateRequestSchema.safeParse({ name: "A\r\nB" }).success
    ).toBe(false);
  });
});
