import {
  JOB_LOCK_SCOPES,
  JOB_TYPE_LABELS,
  JOB_TYPE_SCHEMAS,
  JobTypeEnum,
  jobLockScopes,
  lockScopeKey,
} from "../../models/job.model.js";
import { RunningJobSummarySchema } from "../../contracts/connector-instance.contract.js";

// #769: what each job type makes read-only while it runs. A job locks scopes
// (one connector entity, or a whole connector instance); every object that
// resolves into a locked scope refuses writes.

describe("JOB_LOCK_SCOPES / jobLockScopes (#769)", () => {
  it("instance-wide jobs lock their connector instance", () => {
    for (const type of [
      "connector_sync",
      "layout_plan_commit",
      "entity_record_clear",
    ] as const) {
      expect(
        jobLockScopes(type, {
          connectorInstanceId: "ci-1",
          connectorEntityId: "ce-1",
        })
      ).toEqual([{ kind: "connectorInstance", id: "ci-1" }]);
    }
  });

  it("revalidation and bulk_geocode lock their entity", () => {
    expect(
      jobLockScopes("revalidation", {
        connectorEntityId: "ce-1",
        organizationId: "o",
      })
    ).toEqual([{ kind: "connectorEntity", id: "ce-1" }]);
    expect(
      jobLockScopes("bulk_geocode", {
        connectorEntityId: "ce-2",
        targetConnectorEntityIds: ["ce-2"],
      })
    ).toEqual([{ kind: "connectorEntity", id: "ce-2" }]);
  });

  it("bulk_transform locks its targets and its source", () => {
    expect(
      jobLockScopes("bulk_transform", {
        sourceConnectorEntityId: "src",
        targetConnectorEntityIds: ["t1", "t2"],
      })
    ).toEqual([
      { kind: "connectorEntity", id: "t1" },
      { kind: "connectorEntity", id: "t2" },
      { kind: "connectorEntity", id: "src" },
    ]);
  });

  it("a source that is also a target is locked once", () => {
    expect(
      jobLockScopes("bulk_transform", {
        sourceConnectorEntityId: "t1",
        targetConnectorEntityIds: ["t1"],
      })
    ).toEqual([{ kind: "connectorEntity", id: "t1" }]);
  });

  it("jobs that write no entity data lock nothing", () => {
    for (const type of [
      "file_upload_parse",
      "sql_query",
      "dissolve_precompute",
      "system_check",
    ] as const) {
      expect(jobLockScopes(type, {})).toEqual([]);
    }
  });

  it("#802: entity_data_delete locks nothing — its entities are already deleted", () => {
    expect(
      jobLockScopes("entity_data_delete", {
        organizationId: "o",
        userId: "u",
        connectorEntityIds: ["ce-1", "ce-2"],
        connectorInstanceId: "ci-1",
      })
    ).toEqual([]);
    expect(JOB_TYPE_LABELS.entity_data_delete).toBe("Delete entity data");
  });

  it("#802: entity_data_delete metadata needs at least one entity", () => {
    const schema = JOB_TYPE_SCHEMAS.entity_data_delete.metadata;
    expect(
      schema.safeParse({
        organizationId: "o",
        userId: "u",
        connectorEntityIds: [],
        connectorInstanceId: null,
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        organizationId: "o",
        userId: "u",
        connectorEntityIds: ["ce-1"],
        connectorInstanceId: null,
      }).success
    ).toBe(true);
  });

  it("every job type declares its scopes", () => {
    for (const type of JobTypeEnum.options) {
      expect(typeof JOB_LOCK_SCOPES[type]).toBe("function");
    }
  });

  it("metadata missing an id locks nothing rather than locking undefined", () => {
    expect(jobLockScopes("revalidation", {})).toEqual([]);
    expect(jobLockScopes("connector_sync", null)).toEqual([]);
  });

  it("every job type has a label", () => {
    for (const type of JobTypeEnum.options) {
      expect(JOB_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
    expect(JOB_TYPE_LABELS.connector_sync).toBe("Sync");
  });

  it("lockScopeKey prefixes the kind", () => {
    expect(lockScopeKey({ kind: "connectorEntity", id: "a" })).toBe("entity:a");
    expect(lockScopeKey({ kind: "connectorInstance", id: "b" })).toBe(
      "instance:b"
    );
  });

  it("RunningJobSummarySchema carries the job's lock scopes", () => {
    expect(
      RunningJobSummarySchema.parse({
        id: "j",
        type: "revalidation",
        status: "active",
        startedAt: null,
        created: 1,
        lockScopes: ["entity:a"],
      }).lockScopes
    ).toEqual(["entity:a"]);
  });
});
