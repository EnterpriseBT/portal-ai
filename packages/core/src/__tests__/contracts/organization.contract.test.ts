import {
  OrganizationDeleteRequestSchema,
  OrganizationDeleteResponseSchema,
  OrganizationGetResponseSchema,
  MemberRolesSetRequestSchema,
} from "../../contracts/organization.contract.js";
import { OrganizationModelFactory } from "../../models/organization.model.js";

// ── GET /organization response (#620) ────────────────────────────────

describe("OrganizationGetResponseSchema (#620)", () => {
  const organization = new OrganizationModelFactory()
    .create("user-1")
    .update({ name: "Acme", ownerUserId: "user-1", timezone: "UTC" })
    .parse();

  const capabilities = {
    "billing.manage": true,
    "org.delete": true,
    "org.audit.read": true,
    "member.role.assign": true,
    "member.invite": true,
    "member.remove": true,
  };
  const base = {
    organization,
    roles: ["owner"],
    capabilities,
    role: "owner",
  };

  it("requires roles[] and capabilities alongside the organization", () => {
    expect(OrganizationGetResponseSchema.safeParse(base).success).toBe(true);
  });

  it("accepts multiple roles (multi-role principal)", () => {
    const result = OrganizationGetResponseSchema.safeParse({
      ...base,
      roles: ["admin", "member"],
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a response missing roles[]", () => {
    const { roles: _omit, ...withoutRoles } = base;
    expect(OrganizationGetResponseSchema.safeParse(withoutRoles).success).toBe(
      false
    );
  });

  it("rejects a response missing capabilities", () => {
    const { capabilities: _omit, ...withoutCaps } = base;
    expect(OrganizationGetResponseSchema.safeParse(withoutCaps).success).toBe(
      false
    );
  });
});

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

// ── Set-the-set member roles request (#620, spec case 1) ─────────────

describe("MemberRolesSetRequestSchema (#620/#622)", () => {
  it("accepts a non-empty roleSlugs array (system + custom slugs)", () => {
    expect(
      MemberRolesSetRequestSchema.safeParse({
        roleSlugs: ["admin", "member", "analyst"],
      }).success
    ).toBe(true);
  });

  it("rejects an empty roleSlugs array (≥1-role guard at the edge)", () => {
    expect(
      MemberRolesSetRequestSchema.safeParse({ roleSlugs: [] }).success
    ).toBe(false);
  });

  it("rejects a missing roleSlugs field", () => {
    expect(MemberRolesSetRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty-string slug (per-element min length)", () => {
    expect(
      MemberRolesSetRequestSchema.safeParse({ roleSlugs: [""] }).success
    ).toBe(false);
  });

  it("does not gate slug validity at the schema — the service resolves it (#622)", () => {
    // Unlike the old enum, an arbitrary slug parses; whether it names a real
    // role is checked server-side against the org's roles.
    expect(
      MemberRolesSetRequestSchema.safeParse({ roleSlugs: ["anything"] }).success
    ).toBe(true);
  });
});
