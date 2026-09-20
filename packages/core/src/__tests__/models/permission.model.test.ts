import { describe, it, expect } from "@jest/globals";
import {
  PermissionStatementSchema,
  PermissionStatementModelFactory,
  PolicySchema,
  PolicyModelFactory,
  PolicyAttachmentModelFactory,
  RoleModelFactory,
} from "../../models/permission.model.js";

// ── Tests (spec cases 1–2) ───────────────────────────────────────────

describe("PermissionStatementSchema (spec case 1)", () => {
  const base = {
    id: "stmt-1",
    created: 1,
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "org-1",
    policyId: "pol-1",
    effect: "allow" as const,
    verb: "read" as const,
    resourceType: "station" as const,
    resourceId: null,
    condition: null,
  };

  it("parses an allow class statement", () => {
    const parsed = new PermissionStatementModelFactory()
      .create("user-1")
      .update(base)
      .parse();
    expect(parsed.effect).toBe("allow");
    expect(parsed.verb).toBe("read");
    expect(parsed.resourceType).toBe("station");
    expect(parsed.resourceId).toBeNull();
    expect(parsed.condition).toBeNull();
    expect(parsed.createdBy).toBe("user-1");
  });

  it("parses a deny instance statement with an ownership condition", () => {
    const parsed = new PermissionStatementModelFactory()
      .create("user-1")
      .update({
        ...base,
        effect: "deny",
        verb: "write",
        resourceId: "station-42",
        condition: "created_by_caller",
      })
      .parse();
    expect(parsed.effect).toBe("deny");
    expect(parsed.resourceId).toBe("station-42");
    expect(parsed.condition).toBe("created_by_caller");
  });

  it("rejects an unknown effect / verb / resourceType / condition", () => {
    for (const bad of [
      { effect: "maybe" },
      { verb: "frobnicate" },
      { resourceType: "spaceship" },
      { condition: "when_full_moon" },
    ]) {
      expect(
        PermissionStatementSchema.safeParse({ ...base, ...bad }).success
      ).toBe(false);
    }
  });

  it("accepts the `*` wildcards (FullAccess)", () => {
    expect(
      PermissionStatementSchema.safeParse({
        ...base,
        verb: "*",
        resourceType: "*",
      }).success
    ).toBe(true);
  });
});

describe("Policy / Role / PolicyAttachment (spec case 2)", () => {
  it("Policy round-trips (kind + nullable description)", () => {
    const parsed = new PolicyModelFactory()
      .create("system")
      .update({
        organizationId: "org-1",
        name: "FullAccess",
        kind: "system",
        description: null,
      })
      .parse();
    expect(parsed.name).toBe("FullAccess");
    expect(parsed.kind).toBe("system");
    expect(parsed.description).toBeNull();
    expect(PolicySchema.safeParse(parsed).success).toBe(true);
  });

  it("Policy rejects an unknown kind", () => {
    expect(
      PolicySchema.safeParse({
        id: "p",
        created: 1,
        createdBy: "u",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: "org-1",
        name: "X",
        kind: "root",
        description: null,
      }).success
    ).toBe(false);
  });

  it("Role round-trips", () => {
    const parsed = new RoleModelFactory()
      .create("system")
      .update({ organizationId: "org-1", name: "admin", kind: "system" })
      .parse();
    expect(parsed.name).toBe("admin");
    expect(parsed.kind).toBe("system");
  });

  it("PolicyAttachment round-trips a role principal", () => {
    const parsed = new PolicyAttachmentModelFactory()
      .create("system")
      .update({
        organizationId: "org-1",
        policyId: "pol-1",
        principalType: "role",
        principalId: "role-1",
      })
      .parse();
    expect(parsed.principalType).toBe("role");
    expect(parsed.principalId).toBe("role-1");
  });
});
