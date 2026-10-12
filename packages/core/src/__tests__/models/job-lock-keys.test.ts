import { JOB_LOCK_KEYS, jobTypesLocking } from "../../models/job.model.js";

// #121 child F (gate 4): the portal chat lock. Since #769 entity and
// connector locks are JOB_LOCK_SCOPES (job-lock-scopes.test.ts); this
// registry only says which jobs lock a portal's chat input.

describe("JOB_LOCK_KEYS / jobTypesLocking (portal chat lock)", () => {
  it("portalId locks == bulk_transform + bulk_geocode", () => {
    expect(
      jobTypesLocking("portalId")
        .map((t) => t.type)
        .sort()
    ).toEqual(["bulk_geocode", "bulk_transform"]);
  });

  it("exposes the metadata key each locking type uses", () => {
    expect(jobTypesLocking("portalId")).toContainEqual({
      type: "bulk_transform",
      metadataKey: "portalId",
    });
  });

  it("declares nothing but the portal lock (#769)", () => {
    for (const keys of Object.values(JOB_LOCK_KEYS)) {
      expect(Object.keys(keys ?? {})).toEqual(["portalId"]);
    }
  });
});
