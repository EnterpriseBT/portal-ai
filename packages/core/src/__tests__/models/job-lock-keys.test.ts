import { JOB_LOCK_KEYS, jobTypesLocking } from "../../models/job.model.js";

// #121 child F (gate 4): the lock queries derive their job-type filter from
// this registry. These assert it reproduces today's hardcoded filters and
// preserves the false-lock avoidance an integration test depends on.

describe("JOB_LOCK_KEYS / jobTypesLocking", () => {
  const types = (field: Parameters<typeof jobTypesLocking>[0]) =>
    jobTypesLocking(field)
      .map((t) => t.type)
      .sort();

  it("connectorInstanceId locks == connector_sync + layout_plan_commit", () => {
    expect(types("connectorInstanceId")).toEqual([
      "connector_sync",
      "layout_plan_commit",
    ]);
  });

  it("portalId locks == bulk_transform", () => {
    expect(types("portalId")).toEqual(["bulk_transform"]);
  });

  it("targetConnectorEntityIds locks == bulk_transform only", () => {
    // connector_sync carries connectorInstanceId but NOT
    // targetConnectorEntityIds, so it must not appear here — this is the
    // false-lock avoidance the repository integration test relies on.
    expect(types("targetConnectorEntityIds")).toEqual(["bulk_transform"]);
    expect(types("targetConnectorEntityIds")).not.toContain("connector_sync");
  });

  it("exposes the metadata key each locking type uses", () => {
    expect(jobTypesLocking("targetConnectorEntityIds")).toContainEqual({
      type: "bulk_transform",
      metadataKey: "targetConnectorEntityIds",
    });
  });

  it("read-only / non-locking job types declare no lock keys", () => {
    expect(JOB_LOCK_KEYS.bulk_aggregate).toBeUndefined();
    expect(JOB_LOCK_KEYS.file_upload_parse).toBeUndefined();
    expect(JOB_LOCK_KEYS.system_check).toBeUndefined();
  });
});
