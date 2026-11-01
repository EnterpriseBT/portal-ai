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
