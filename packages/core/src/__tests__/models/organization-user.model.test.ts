import {
  ORG_ROLES,
  OrgRoleSchema,
  OrganizationUserSchema,
  OrganizationUserModel,
  OrganizationUserModelFactory,
} from "../../models/organization-user.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Tests ───────────────────────────────────────────────────────────

describe("OrganizationUserModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new OrganizationUserModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(OrganizationUserModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: OrganizationUserModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new OrganizationUserModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return an OrganizationUserModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(OrganizationUserModel);
    });

    it("should assign the generated id from the underlying CoreModelFactory", () => {
      const model = factory.create("user-1");
      expect(model.toJSON().id).toBe("test-id-1");
    });

    it("should set the createdBy field to the provided value", () => {
      const model = factory.create("admin-42");
      expect(model.toJSON().createdBy).toBe("admin-42");
    });

    it("should set a created timestamp", () => {
      const before = Date.now();
      const model = factory.create("user-1");
      const after = Date.now();
      const created = model.toJSON().created;

      expect(created).toBeDefined();
      expect(created).toBeGreaterThanOrEqual(before);
      expect(created).toBeLessThanOrEqual(after);
    });

    it("should not set updated, updatedBy, deleted, or deletedBy", () => {
      const json = factory.create("user-1").toJSON();

      expect(json.updated).toBeNull();
      expect(json.updatedBy).toBeNull();
      expect(json.deleted).toBeNull();
      expect(json.deletedBy).toBeNull();
    });

    it("should produce unique ids across multiple calls", () => {
      const defaultFactory = new OrganizationUserModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new OrganizationUserModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should return a different OrganizationUserModel instance on each call", () => {
      const a = factory.create("user-a");
      const b = factory.create("user-b");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });

    it("should expose the OrganizationUserSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("organizationId");
      expect(shape).toHaveProperty("userId");
    });

    it("should allow updating organizationId and userId after creation", () => {
      const model = factory.create("user-1");
      model.update({
        organizationId: "org-abc",
        userId: "usr-xyz",
      });

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-abc");
      expect(json.userId).toBe("usr-xyz");
      // base fields should still be present
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update({
        organizationId: "org-1",
        userId: "usr-1",
        role: "member",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        lastLogin: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when organizationId is missing", () => {
      const model = factory.create("user-1");
      model.update({
        userId: "usr-1",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain("organizationId");
      }
    });

    it("should fail validation when userId is missing", () => {
      const model = factory.create("user-1");
      model.update({
        organizationId: "org-1",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain("userId");
      }
    });

    it("should fail validation when both organizationId and userId are missing", () => {
      const model = factory.create("user-1");
      model.update({
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain("organizationId");
        expect(paths).toContain("userId");
      }
    });
  });
});

// ── role (#576) ──────────────────────────────────────────────────────

describe("OrgRoleSchema (#576)", () => {
  it("accepts owner, admin, and member", () => {
    for (const role of ORG_ROLES) {
      expect(OrgRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects an unknown role (e.g. viewer)", () => {
    expect(OrgRoleSchema.safeParse("viewer").success).toBe(false);
  });

  it("exposes exactly owner/admin/member in order", () => {
    expect([...ORG_ROLES]).toEqual(["owner", "admin", "member"]);
  });
});

describe("OrganizationUserSchema.role (#576)", () => {
  const validFields = {
    organizationId: "org-1",
    userId: "user-1",
    role: "member" as const,
    lastLogin: 0,
  };

  it("round-trips an explicit role through the factory", () => {
    const parsed = new OrganizationUserModelFactory()
      .create("user-1")
      .update({ ...validFields, role: "owner" })
      .parse();
    expect(parsed.role).toBe("owner");
    expect(OrganizationUserSchema.safeParse(parsed).success).toBe(true);
  });

  it("accepts every declared role", () => {
    for (const role of ORG_ROLES) {
      const model = new OrganizationUserModelFactory()
        .create("user-1")
        .update({ ...validFields, role });
      expect(model.validate().success).toBe(true);
    }
  });

  it("rejects an unknown role", () => {
    const model = new OrganizationUserModelFactory()
      .create("user-1")
      .update({ ...validFields, role: "superuser" as never });
    expect(model.validate().success).toBe(false);
  });

  it("requires role — validation fails when omitted (no silent default)", () => {
    const { role: _omitted, ...rest } = validFields;
    const model = new OrganizationUserModelFactory()
      .create("user-1")
      .update(rest);
    const result = model.validate();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain("role");
    }
  });

  it("exposes role via the model schema getter", () => {
    const shape = new OrganizationUserModel({}).schema.shape;
    expect(shape).toHaveProperty("role");
  });
});
