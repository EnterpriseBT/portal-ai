import { JobTypeEnum } from "@portalai/core/models";

import {
  jobLockReason,
  joinRunningJobLabels,
  runningJobLabel,
} from "../utils/running-job-label.util";

describe("joinRunningJobLabels", () => {
  it("joins labels in prose", () => {
    expect(joinRunningJobLabels([{ type: "connector_sync" }])).toBe("Sync");
    expect(
      joinRunningJobLabels([
        { type: "layout_plan_commit" },
        { type: "connector_sync" },
      ])
    ).toBe("Import and Sync");
  });
});

describe("runningJobLabel (#769)", () => {
  it("names every job type, from core's labels", () => {
    for (const type of JobTypeEnum.options) {
      expect(runningJobLabel({ type })).not.toBe(type);
    }
    expect(runningJobLabel({ type: "entity_record_clear" })).toBe(
      "Delete records"
    );
    expect(runningJobLabel({ type: "bulk_geocode" })).toBe("Geocoding");
  });

  it("falls back to the raw type for one it doesn't know", () => {
    expect(runningJobLabel({ type: "future_job" })).toBe("future_job");
  });
});

describe("jobLockReason (#769)", () => {
  const job = (type: string, lockScopes: string[]) => ({ type, lockScopes });

  it("is null when nothing is running", () => {
    expect(jobLockReason([], { kind: "connectorEntity", id: "e1" })).toBeNull();
  });

  it("on an entity page, names this entity or its connector", () => {
    expect(
      jobLockReason([job("revalidation", ["entity:e1"])], {
        kind: "connectorEntity",
        id: "e1",
      })
    ).toBe(
      "Revalidation is running on this entity — try again when it finishes."
    );
    expect(
      jobLockReason([job("connector_sync", ["instance:c1"])], {
        kind: "connectorEntity",
        id: "e1",
      })
    ).toBe("Sync is running on this connector — try again when it finishes.");
  });

  it("on a connector page, says when the job holds one of its entities", () => {
    expect(
      jobLockReason([job("connector_sync", ["instance:c1"])], {
        kind: "connectorInstance",
        id: "c1",
      })
    ).toBe("Sync is running on this connector — try again when it finishes.");
    expect(
      jobLockReason([job("revalidation", ["entity:e1"])], {
        kind: "connectorInstance",
        id: "c1",
      })
    ).toBe(
      "Revalidation is running on one of this connector's entities — try again when it finishes."
    );
  });

  it("on a column-definition page, points at the entities that use it", () => {
    expect(
      jobLockReason([job("bulk_geocode", ["entity:e1"])], {
        kind: "columnDefinition",
        id: "cd1",
      })
    ).toBe(
      "Geocoding is running on an entity that uses this column definition — try again when it finishes."
    );
  });

  it("joins several jobs", () => {
    expect(
      jobLockReason(
        [
          job("layout_plan_commit", ["instance:c1"]),
          job("connector_sync", ["instance:c1"]),
        ],
        { kind: "connectorInstance", id: "c1" }
      )
    ).toBe(
      "Import and Sync are running on this connector — try again when they finish."
    );
  });
});
