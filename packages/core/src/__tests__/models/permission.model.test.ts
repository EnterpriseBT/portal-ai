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
  POLICY_PRINCIPAL_TYPES,
  GroupSchema,
  GroupModelFactory,
  UserGroupSchema,
  UserGroupModelFactory,
  PERMISSION_VERBS,
  PERMISSION_RESOURCE_TYPES,
  NAV_PAGE_IDS,
  MEMBER_VIEW_PAGE_IDS,
  RESOURCE_PERMISSION_TYPES,
  PagePermissionMapSchema,
  ResourcePermissionMapSchema,
  RESOURCE_CAPABILITIES,
  verbsForResource,
  defaultVerbForResource,
  resourceAllowsInstanceScope,
  resourceAllowsOwnership,
  isVerbValidForResource,
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
      .update({
        organizationId: "org-1",
        name: "admin",
        slug: "admin",
        kind: "system",
      })
      .parse();
    expect(parsed.name).toBe("admin");
    expect(parsed.slug).toBe("admin");
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

  it("accepts a group principal (#622)", () => {
    expect(
      PermissionGrantSchema.safeParse({
        ...base,
        principalType: "group",
        principalId: "grp-1",
      }).success
    ).toBe(true);
  });

  it("rejects an unknown principalType", () => {
    expect(
      PermissionGrantSchema.safeParse({ ...base, principalType: "team" })
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

// ── Group + UserGroup (#622 slice 1) ─────────────────────────────────

describe("Group / UserGroup schemas (#622)", () => {
  it("POLICY_PRINCIPAL_TYPES includes group", () => {
    expect([...POLICY_PRINCIPAL_TYPES]).toEqual(["user", "role", "group"]);
  });

  it("GroupModelFactory produces a valid group with a nullable description", () => {
    const g = new GroupModelFactory()
      .create("user-1")
      .update({ organizationId: "org-1", name: "Analysts", description: null });
    const r = GroupSchema.safeParse(g.toJSON());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Analysts");
      expect(r.data.description).toBeNull();
    }
  });

  it("GroupSchema rejects an empty name", () => {
    const g = new GroupModelFactory()
      .create("user-1")
      .update({ organizationId: "org-1", name: "", description: null });
    expect(GroupSchema.safeParse(g.toJSON()).success).toBe(false);
  });

  it("UserGroupModelFactory round-trips a membership edge", () => {
    const m = new UserGroupModelFactory().create("user-1").update({
      organizationId: "org-1",
      userId: "user-2",
      groupId: "grp-1",
    });
    const r = UserGroupSchema.safeParse(m.toJSON());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.userId).toBe("user-2");
      expect(r.data.groupId).toBe("grp-1");
    }
  });
});

// ── Page + object permission surfaces (#630) ─────────────────────────

describe("permission vocabulary (#630)", () => {
  it("adds the `view` verb without dropping the existing ones", () => {
    expect(PERMISSION_VERBS).toContain("view");
    for (const v of [
      "read",
      "write",
      "delete",
      "share",
      "manage",
      "invite",
      "*",
    ])
      expect(PERMISSION_VERBS).toContain(v);
  });

  it("adds the six plumbing/page resource types", () => {
    for (const t of [
      "entity_group",
      "tag",
      "column_definition",
      "job",
      "toolpack",
      "page",
    ])
      expect(PERMISSION_RESOURCE_TYPES).toContain(t);
  });

  it("a `view page:<id>` statement parses (verb + type are valid together)", () => {
    expect(
      PermissionStatementSchema.safeParse({
        id: "s",
        created: 1,
        createdBy: "u",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: "org-1",
        policyId: "pol-1",
        effect: "allow",
        verb: "view",
        resourceType: "page",
        resourceId: "connectors",
        condition: null,
      }).success
    ).toBe(true);
  });

  it("NAV_PAGE_IDS is one id per page (no per-tab ids) and omits Dashboard", () => {
    expect(NAV_PAGE_IDS).toContain("connectors");
    // Tabs are gated by object read, not page ids — connector_catalog is gone.
    expect(NAV_PAGE_IDS).not.toContain("connector_catalog");
    expect(NAV_PAGE_IDS).not.toContain("dashboard");
  });

  it("MEMBER_VIEW_PAGE_IDS is exactly the member pages (Decision A)", () => {
    expect([...MEMBER_VIEW_PAGE_IDS].sort()).toEqual([
      "jobs",
      "pinned",
      "stations",
    ]);
    // Admin pages carry no member grant.
    expect([...MEMBER_VIEW_PAGE_IDS]).not.toContain("connectors");
  });
});

describe("PagePermissionMapSchema (#630)", () => {
  const full = Object.fromEntries(NAV_PAGE_IDS.map((id) => [id, true]));

  it("accepts a map keyed by every nav page id", () => {
    expect(PagePermissionMapSchema.safeParse(full).success).toBe(true);
  });

  it("is exhaustive — a partial map is rejected", () => {
    expect(PagePermissionMapSchema.safeParse({ stations: true }).success).toBe(
      false
    );
  });

  it("rejects an unknown page id", () => {
    expect(
      PagePermissionMapSchema.safeParse({ ...full, settings: true }).success
    ).toBe(false);
  });
});

describe("ResourcePermissionMapSchema (#630)", () => {
  const rwx = { read: true, write: false, delete: false };
  const full = Object.fromEntries(
    RESOURCE_PERMISSION_TYPES.map((t) => [t, rwx])
  );

  it("covers the data + plumbing object types, not page/billing/org", () => {
    expect(RESOURCE_PERMISSION_TYPES).toContain("connector_instance");
    expect(RESOURCE_PERMISSION_TYPES).toContain("connector_definition");
    expect(RESOURCE_PERMISSION_TYPES).toContain("toolpack");
    for (const excluded of ["page", "billing", "org", "member", "audit", "*"])
      expect(RESOURCE_PERMISSION_TYPES).not.toContain(excluded);
  });

  it("renames the `view` object type to `curated_view` (verb/type collision)", () => {
    expect(PERMISSION_RESOURCE_TYPES).toContain("curated_view");
    expect(PERMISSION_RESOURCE_TYPES).not.toContain("view");
    // The `view` VERB still exists (distinct from the type).
    expect(PERMISSION_VERBS).toContain("view");
  });

  it("accepts a full read/write/delete map", () => {
    expect(ResourcePermissionMapSchema.safeParse(full).success).toBe(true);
  });

  it("rejects a value missing a verb", () => {
    expect(
      ResourcePermissionMapSchema.safeParse({
        ...full,
        toolpack: { read: true, write: true },
      }).success
    ).toBe(false);
  });
});

describe("RESOURCE_CAPABILITIES — statement validity matrix (#630)", () => {
  it("covers every resource type exactly", () => {
    expect(Object.keys(RESOURCE_CAPABILITIES).sort()).toEqual(
      [...PERMISSION_RESOURCE_TYPES].sort()
    );
  });

  it("every listed verb is a real verb, and each set is non-empty", () => {
    for (const t of PERMISSION_RESOURCE_TYPES) {
      const verbs = verbsForResource(t);
      expect(verbs.length).toBeGreaterThan(0);
      for (const v of verbs) expect(PERMISSION_VERBS).toContain(v);
      // the default is the first offered verb
      expect(verbs).toContain(defaultVerbForResource(t));
    }
  });

  it("`view` pairs with `page` and nothing else — the coupling falls out", () => {
    for (const t of PERMISSION_RESOURCE_TYPES) {
      expect(isVerbValidForResource("view", t)).toBe(t === "page");
    }
    // and `page` is view-only
    expect(verbsForResource("page")).toEqual(["view"]);
    expect(isVerbValidForResource("read", "page")).toBe(false);
  });

  it("object types take read/write/delete (+ share only when shareable)", () => {
    for (const t of RESOURCE_PERMISSION_TYPES) {
      const verbs = verbsForResource(t);
      expect(verbs).toEqual(
        expect.arrayContaining(["read", "write", "delete"])
      );
      const shareable = (
        SHAREABLE_RESOURCE_TYPES as readonly string[]
      ).includes(t);
      expect(verbs.includes("share")).toBe(shareable);
    }
  });

  it("every privileged capability action maps to a valid (verb, resource) pair", () => {
    // The authoritative dotted-action → (verb, resource) mapping (mirrors the
    // engine's ACTION_MAP). The matrix must cover each, so an admin surface can't
    // silently become un-authorable.
    const CAPABILITY_PAIRS: Record<
      (typeof CALLER_CAPABILITY_ACTIONS)[number],
      { verb: string; resourceType: string }
    > = {
      "billing.manage": { verb: "manage", resourceType: "billing" },
      "org.delete": { verb: "delete", resourceType: "org" },
      "org.audit.read": { verb: "read", resourceType: "audit" },
      "member.role.assign": { verb: "manage", resourceType: "member" },
      "member.invite": { verb: "invite", resourceType: "member" },
      "member.remove": { verb: "delete", resourceType: "member" },
    };
    for (const action of CALLER_CAPABILITY_ACTIONS) {
      const { verb, resourceType } = CAPABILITY_PAIRS[action];
      expect(
        isVerbValidForResource(
          verb as (typeof PERMISSION_VERBS)[number],
          resourceType as (typeof PERMISSION_RESOURCE_TYPES)[number]
        )
      ).toBe(true);
    }
  });

  it("privileged singletons + page are class-scoped without ownership; data types own", () => {
    for (const t of ["billing", "org", "member", "audit", "page"] as const) {
      expect(resourceAllowsInstanceScope(t)).toBe(t === "page");
      expect(resourceAllowsOwnership(t)).toBe(false);
    }
    for (const t of RESOURCE_PERMISSION_TYPES) {
      expect(resourceAllowsOwnership(t)).toBe(true);
    }
  });
});
