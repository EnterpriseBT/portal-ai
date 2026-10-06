/**
 * #689: the entity page's action gates, mirroring each route's checks —
 * permission (per-object entity, or class-level entity_record), then the
 * connector's write flag where the route asserts it, then the running-job
 * lock, then the action's own pending state.
 */
import { WRITES_DISABLED_REASON } from "../utils/connector-instance-actions.util";
import {
  entityDetailActionGates,
  entityRecordActionGates,
  fieldMappingRowGates,
  type EntityDetailActionGateInput,
  type EntityRecordActionGateInput,
} from "../utils/entity-actions.util";

const LOCK = "Sync is running on this connector — try again when it finishes.";

const base: EntityDetailActionGateInput = {
  capabilities: { read: true, write: true, delete: true },
  recordPermissions: { create: true, revalidate: true, clear: true },
  isWriteEnabled: true,
  lockedReason: null,
  isUpdating: false,
  isDeleting: false,
  isClearingRecords: false,
  isRevalidating: false,
};

describe("entityDetailActionGates", () => {
  it("allows everything for a writer on an idle, write-enabled connector", () => {
    const g = entityDetailActionGates(base);
    for (const gate of [
      g.edit,
      g.delete,
      g.createRecord,
      g.clearRecords,
      g.revalidate,
    ]) {
      expect(gate).toEqual({ kind: "allow" });
    }
    expect(g.canEditTags).toBe(true);
  });

  it("hides entity Edit and tag editing without write on the entity", () => {
    const g = entityDetailActionGates({
      ...base,
      capabilities: { read: true, write: false, delete: true },
    });
    expect(g.edit).toEqual({ kind: "hide" });
    expect(g.canEditTags).toBe(false);
    expect(g.delete).toEqual({ kind: "allow" });
  });

  it("hides entity Delete without delete on the entity", () => {
    const g = entityDetailActionGates({
      ...base,
      capabilities: { read: true, write: true, delete: false },
    });
    expect(g.delete).toEqual({ kind: "hide" });
  });

  it("gates the record actions on the entity-wide record permissions", () => {
    const g = entityDetailActionGates({
      ...base,
      recordPermissions: { create: false, revalidate: false, clear: false },
    });
    expect(g.createRecord).toEqual({ kind: "hide" });
    expect(g.clearRecords).toEqual({ kind: "hide" });
    expect(g.revalidate).toEqual({ kind: "hide" });
  });

  it("disables the flag-checked actions when the connector's writes are off", () => {
    const g = entityDetailActionGates({ ...base, isWriteEnabled: false });
    const disabled = { kind: "disable", reason: WRITES_DISABLED_REASON };
    expect(g.edit).toEqual(disabled);
    expect(g.createRecord).toEqual(disabled);
    expect(g.clearRecords).toEqual(disabled);
    // The delete and revalidate routes don't check the flag.
    expect(g.delete).toEqual({ kind: "allow" });
    expect(g.revalidate).toEqual({ kind: "allow" });
    // Tag assignment checks entity write only.
    expect(g.canEditTags).toBe(true);
  });

  it("disables every locked action with the job reason", () => {
    const g = entityDetailActionGates({ ...base, lockedReason: LOCK });
    for (const gate of [
      g.edit,
      g.delete,
      g.createRecord,
      g.clearRecords,
      g.revalidate,
    ]) {
      expect(gate).toEqual({ kind: "disable", reason: LOCK });
    }
  });

  it("names a pending action's own state", () => {
    const g = entityDetailActionGates({
      ...base,
      isUpdating: true,
      isDeleting: true,
      isClearingRecords: true,
      isRevalidating: true,
    });
    expect(g.edit).toEqual({ kind: "disable", reason: "Saving…" });
    expect(g.delete).toEqual({ kind: "disable", reason: "Deleting…" });
    expect(g.clearRecords).toEqual({
      kind: "disable",
      reason: "Deleting records…",
    });
    expect(g.revalidate).toEqual({ kind: "disable", reason: "Re-validating…" });
  });

  it("puts permission before the flag, and the flag before the lock", () => {
    expect(
      entityDetailActionGates({
        ...base,
        capabilities: { read: true, write: false, delete: false },
        isWriteEnabled: false,
        lockedReason: LOCK,
      }).edit
    ).toEqual({ kind: "hide" });
    expect(
      entityDetailActionGates({
        ...base,
        isWriteEnabled: false,
        lockedReason: LOCK,
      }).edit
    ).toEqual({ kind: "disable", reason: WRITES_DISABLED_REASON });
  });
});

describe("entityRecordActionGates", () => {
  const recordBase: EntityRecordActionGateInput = {
    capabilities: { read: true, write: true, delete: true },
    canRevalidate: true,
    isWriteEnabled: true,
    lockedReason: null,
    isUpdating: false,
    isDeleting: false,
    isRevalidating: false,
  };

  it("allows Edit, Delete and Re-validate for a writer", () => {
    const g = entityRecordActionGates(recordBase);
    expect(g.edit).toEqual({ kind: "allow" });
    expect(g.delete).toEqual({ kind: "allow" });
    expect(g.revalidate).toEqual({ kind: "allow" });
  });

  it("hides Edit/Delete from the record's capabilities and Re-validate from the class write", () => {
    const g = entityRecordActionGates({
      ...recordBase,
      capabilities: { read: true, write: false, delete: false },
      canRevalidate: false,
    });
    expect(g.edit).toEqual({ kind: "hide" });
    expect(g.delete).toEqual({ kind: "hide" });
    expect(g.revalidate).toEqual({ kind: "hide" });
  });

  it("disables Edit and Delete (both routes check the flag) but not Re-validate when writes are off", () => {
    const g = entityRecordActionGates({ ...recordBase, isWriteEnabled: false });
    const disabled = { kind: "disable", reason: WRITES_DISABLED_REASON };
    expect(g.edit).toEqual(disabled);
    expect(g.delete).toEqual(disabled);
    expect(g.revalidate).toEqual({ kind: "allow" });
  });

  it("disables all three with the lock reason, then names pending state", () => {
    const locked = entityRecordActionGates({
      ...recordBase,
      lockedReason: LOCK,
    });
    for (const gate of [locked.edit, locked.delete, locked.revalidate]) {
      expect(gate).toEqual({ kind: "disable", reason: LOCK });
    }
    const pending = entityRecordActionGates({
      ...recordBase,
      isUpdating: true,
      isDeleting: true,
      isRevalidating: true,
    });
    expect(pending.edit).toEqual({
      kind: "disable",
      reason: "Saving changes…",
    });
    expect(pending.delete).toEqual({ kind: "disable", reason: "Deleting…" });
    expect(pending.revalidate).toEqual({
      kind: "disable",
      reason: "Re-validating…",
    });
  });
});

describe("fieldMappingRowGates", () => {
  it("allows Edit and Delete from the row's capabilities", () => {
    expect(
      fieldMappingRowGates({
        capabilities: { read: true, write: true, delete: true },
        isWriteEnabled: true,
      })
    ).toEqual({ edit: { kind: "allow" }, delete: { kind: "allow" } });
  });

  it("hides what the caller can't do on the row", () => {
    expect(
      fieldMappingRowGates({
        capabilities: { read: true, write: false, delete: false },
        isWriteEnabled: true,
      })
    ).toEqual({ edit: { kind: "hide" }, delete: { kind: "hide" } });
  });

  it("disables both when the connector's writes are off (both routes check it)", () => {
    const disabled = { kind: "disable", reason: WRITES_DISABLED_REASON };
    expect(
      fieldMappingRowGates({
        capabilities: { read: true, write: true, delete: true },
        isWriteEnabled: false,
      })
    ).toEqual({ edit: disabled, delete: disabled });
  });
});

// #689 (code review): a member writes and deletes their own records, but
// re-validate and clear are entity-wide. Create stays available to them.
describe("entityDetailActionGates — a member's record permissions", () => {
  it("offers Create but hides Re-validate and Delete records", () => {
    const g = entityDetailActionGates({
      ...base,
      recordPermissions: { create: true, revalidate: false, clear: false },
    });
    expect(g.createRecord).toEqual({ kind: "allow" });
    expect(g.revalidate).toEqual({ kind: "hide" });
    expect(g.clearRecords).toEqual({ kind: "hide" });
  });
});
