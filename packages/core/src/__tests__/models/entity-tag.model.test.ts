import {
  EntityTagModelFactory,
  EntityTagSchema,
} from "../../models/entity-tag.model.js";
import { isSessionGenerated } from "../../models/provenance.model.js";

const base = {
  id: "tag-1",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  organizationId: "org-1",
  name: "Finance",
  color: null,
  description: null,
};

describe("EntityTagSchema provenance (#1071)", () => {
  it("defaults sourcePortalId to null when a creation path omits it", () => {
    const parsed = EntityTagSchema.parse(base);
    expect(parsed.sourcePortalId).toBeNull();
    expect(isSessionGenerated(parsed)).toBe(false);
  });

  it("keeps the portal a session-created tag came from", () => {
    const parsed = EntityTagSchema.parse({ ...base, sourcePortalId: "p-1" });
    expect(parsed.sourcePortalId).toBe("p-1");
    expect(isSessionGenerated(parsed)).toBe(true);
  });

  it("accepts an explicit null", () => {
    expect(
      EntityTagSchema.safeParse({ ...base, sourcePortalId: null }).success
    ).toBe(true);
  });

  it("lets the factory build a tag with no provenance", () => {
    const model = new EntityTagModelFactory().create("user-1");
    model.update({
      organizationId: "org-1",
      name: "Finance",
      color: null,
      description: null,
    });
    expect(model.parse().sourcePortalId).toBeNull();
  });
});
