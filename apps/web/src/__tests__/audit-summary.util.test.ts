import { auditActionSummary } from "../utils/audit-summary.util";

describe("auditActionSummary (#907)", () => {
  it("summarizes an org rename", () => {
    expect(
      auditActionSummary({
        action: "org.update",
        metadata: { field: "name", from: "Acme", to: "Acme Corp" },
      })
    ).toBe('Renamed from "Acme" to "Acme Corp"');
  });

  it("returns null for an org.update of another field", () => {
    expect(
      auditActionSummary({
        action: "org.update",
        metadata: { field: "timezone", from: "UTC", to: "Europe/Paris" },
      })
    ).toBeNull();
  });

  it("returns null for another action, or malformed metadata", () => {
    expect(
      auditActionSummary({ action: "org.delete", metadata: { name: "Acme" } })
    ).toBeNull();
    expect(
      auditActionSummary({ action: "org.update", metadata: null })
    ).toBeNull();
    expect(
      auditActionSummary({
        action: "org.update",
        metadata: { field: "name", from: 1, to: "Acme" },
      })
    ).toBeNull();
  });
});

describe("auditActionSummary — default station (#935)", () => {
  const entry = (metadata: Record<string, unknown>) => ({
    action: "org.update" as const,
    metadata: { field: "defaultStationId", ...metadata },
  });

  it("set from none", () => {
    expect(
      auditActionSummary(
        entry({ from: null, to: "st-b", fromName: null, toName: "Sales" })
      )
    ).toBe('Default station set to "Sales"');
  });

  it("changed", () => {
    expect(
      auditActionSummary(
        entry({ from: "st-a", to: "st-b", fromName: "Main", toName: "Sales" })
      )
    ).toBe('Default station changed from "Main" to "Sales"');
  });

  it("cleared", () => {
    expect(
      auditActionSummary(
        entry({ from: "st-a", to: null, fromName: "Main", toName: null })
      )
    ).toBe('Default station cleared (was "Main")');
  });

  it("an entry missing a name reads a neutral 'a station'", () => {
    expect(
      auditActionSummary(entry({ from: "st-a", to: "st-b", toName: "Sales" }))
    ).toBe('Default station changed from a station to "Sales"');
    expect(auditActionSummary(entry({ from: "st-a", to: null }))).toBe(
      "Default station cleared (was a station)"
    );
  });

  it("returns null when the ids are malformed or nothing changed", () => {
    expect(auditActionSummary(entry({ from: 1, to: "st-b" }))).toBeNull();
    expect(auditActionSummary(entry({ from: null, to: null }))).toBeNull();
  });
});
