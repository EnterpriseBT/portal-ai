import {
  OrganizationDeleteRequestSchema,
  OrganizationDeleteResponseSchema,
} from "../../contracts/organization.contract.js";

// ── Delete request body ──────────────────────────────────────────────

describe("OrganizationDeleteRequestSchema", () => {
  it("should accept a non-empty confirmationName", () => {
    const result = OrganizationDeleteRequestSchema.safeParse({
      confirmationName: "Acme",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmationName).toBe("Acme");
    }
  });

  it("should reject a missing confirmationName", () => {
    const result = OrganizationDeleteRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject an empty confirmationName", () => {
    const result = OrganizationDeleteRequestSchema.safeParse({
      confirmationName: "",
    });
    expect(result.success).toBe(false);
  });
});

// ── Delete response payload ──────────────────────────────────────────

describe("OrganizationDeleteResponseSchema", () => {
  it("should round-trip the deleted organization id", () => {
    const result = OrganizationDeleteResponseSchema.safeParse({ id: "org-1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("org-1");
    }
  });

  it("should reject a payload without id", () => {
    const result = OrganizationDeleteResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
