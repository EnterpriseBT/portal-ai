import { describe, it, expect } from "@jest/globals";
import {
  PermissionStatementSchema,
  PermissionStatementModelFactory,
  PolicySchema,
  PolicyModelFactory,
  PolicyAttachmentModelFactory,
  RoleModelFactory,
  CALLER_CAPABILITY_ACTIONS,
  CapabilityMapSchema,
  PermissionGrantSchema,
  PermissionGrantModelFactory,
  SHAREABLE_RESOURCE_TYPES,
} from "../../models/permission.model.js";
import { highestRole } from "../../models/organization-user.model.js";

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

// ── Caller capability map (#620, spec case 2) ────────────────────────

describe("CapabilityMapSchema (#620)", () => {
  const fullMap = Object.fromEntries(
    CALLER_CAPABILITY_ACTIONS.map((a) => [a, true])
  );

  it("accepts a map keyed by every caller-capability action", () => {
    const result = CapabilityMapSchema.safeParse(fullMap);
    expect(result.success).toBe(true);
  });

  it("is exhaustive — a partial map is rejected (the server always returns all keys)", () => {
    const result = CapabilityMapSchema.safeParse({ "billing.manage": false });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown action key", () => {
    const result = CapabilityMapSchema.safeParse({
      ...fullMap,
      "not.a.capability": true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    const result = CapabilityMapSchema.safeParse({
      ...fullMap,
      "org.delete": "yes",
    });
    expect(result.success).toBe(false);
  });

  it("exposes the app-level actions the FE gates on, and no object-level ones", () => {
    expect(CALLER_CAPABILITY_ACTIONS).toContain("billing.manage");
    expect(CALLER_CAPABILITY_ACTIONS).toContain("member.role.assign");
    // Object-level (resource.*) gates stay per-object (#621), never in this map.
    expect(
      CALLER_CAPABILITY_ACTIONS.some((a) => a.startsWith("resource."))
    ).toBe(false);
  });
});

// ── highestRole (#620 transitional derivation) ───────────────────────

describe("highestRole (#620)", () => {
  it("ranks owner > admin > member", () => {
    expect(highestRole(["member", "owner", "admin"])).toBe("owner");
    expect(highestRole(["member", "admin"])).toBe("admin");
    expect(highestRole(["member"])).toBe("member");
  });

  it("defaults to member for an empty role set", () => {
    expect(highestRole([])).toBe("member");
  });
});

// ── PermissionGrant (#621) ───────────────────────────────────────────

describe("PermissionGrantSchema (#621)", () => {
  const base = new PermissionGrantModelFactory()
    .create("user-1")
    .update({
      organizationId: "org-1",
      principalType: "user",
      principalId: "u-2",
      effect: "allow",
      verb: "read",
      resourceType: "station",
      resourceId: "st-1",
      condition: null,
    })
    .parse();

  it("round-trips a principal-bearing grant", () => {
    const r = PermissionGrantSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.principalType).toBe("user");
      expect(r.data.verb).toBe("read");
      expect(r.data.resourceId).toBe("st-1");
    }
  });

  it("accepts a role principal (team share) + a deny effect", () => {
    expect(
      PermissionGrantSchema.safeParse({
        ...base,
        principalType: "role",
        principalId: "sysrole:org-1:member",
        effect: "deny",
        verb: "write",
      }).success
    ).toBe(true);
  });

  it("rejects an unknown principalType", () => {
    expect(
      PermissionGrantSchema.safeParse({ ...base, principalType: "group" })
        .success
    ).toBe(false);
  });

  it("rejects an unknown verb", () => {
    expect(
      PermissionGrantSchema.safeParse({ ...base, verb: "frobnicate" }).success
    ).toBe(false);
  });

  it("SHAREABLE_RESOURCE_TYPES is station + pin only", () => {
    expect([...SHAREABLE_RESOURCE_TYPES]).toEqual(["station", "pin"]);
  });
});
