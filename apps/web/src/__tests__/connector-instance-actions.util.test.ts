/**
 * #689: the connector-instance page's action gates, decided from the
 * instance's own `capabilities`, the class-level entity create, the
 * connector's write flag and the running-job lock.
 */
import {
  connectorInstanceActionGates,
  WRITES_DISABLED_REASON,
} from "../utils/connector-instance-actions.util";

const caps = (write: boolean, del: boolean) => ({
  read: true,
  write,
  delete: del,
});

const base = {
  capabilities: caps(true, true),
  canCreateEntity: true,
  isWriteEnabled: true,
  lockedReason: null,
};

describe("connectorInstanceActionGates", () => {
  it("allows everything for a writer on an unlocked, write-enabled connector", () => {
    const g = connectorInstanceActionGates(base);
    expect(g.edit).toEqual({ kind: "allow" });
    expect(g.sync).toEqual({ kind: "allow" });
    expect(g.reconnect).toEqual({ kind: "allow" });
    expect(g.editLayoutPlan).toEqual({ kind: "allow" });
    expect(g.delete).toEqual({ kind: "allow" });
    expect(g.createEntity).toEqual({ kind: "allow" });
    expect(g.canEditFlags).toBe(true);
  });

  it("hides write actions and makes the flags read-only without write", () => {
    const g = connectorInstanceActionGates({
      ...base,
      capabilities: caps(false, true),
    });
    for (const gate of [g.edit, g.sync, g.reconnect, g.editLayoutPlan]) {
      expect(gate).toEqual({ kind: "hide" });
    }
    expect(g.delete).toEqual({ kind: "allow" });
    expect(g.canEditFlags).toBe(false);
  });

  it("hides Delete without delete", () => {
    const g = connectorInstanceActionGates({
      ...base,
      capabilities: caps(true, false),
    });
    expect(g.delete).toEqual({ kind: "hide" });
    expect(g.edit).toEqual({ kind: "allow" });
  });

  it("disables every permitted action with the lock reason while a job runs", () => {
    const reason =
      "Sync is running on this connector — try again when it finishes.";
    const g = connectorInstanceActionGates({ ...base, lockedReason: reason });
    for (const gate of [
      g.edit,
      g.sync,
      g.editLayoutPlan,
      g.delete,
      g.createEntity,
    ]) {
      expect(gate).toEqual({ kind: "disable", reason });
    }
  });

  it("still hides an unpermitted action while locked (permission outranks state)", () => {
    const g = connectorInstanceActionGates({
      ...base,
      capabilities: caps(false, false),
      lockedReason: "Sync is running",
    });
    expect(g.edit).toEqual({ kind: "hide" });
    expect(g.delete).toEqual({ kind: "hide" });
  });

  it("gates Create Entity on the class create, not on instance write", () => {
    expect(
      connectorInstanceActionGates({ ...base, canCreateEntity: false })
        .createEntity
    ).toEqual({ kind: "hide" });
    expect(
      connectorInstanceActionGates({
        ...base,
        capabilities: caps(false, false),
      }).createEntity
    ).toEqual({ kind: "allow" });
  });

  it("disables Create Entity when the connector's write flag is off", () => {
    const g = connectorInstanceActionGates({ ...base, isWriteEnabled: false });
    expect(g.createEntity).toEqual({
      kind: "disable",
      reason: WRITES_DISABLED_REASON,
    });
  });

  it("does not lock Reconnect (re-authorizing doesn't touch the locked data)", () => {
    const g = connectorInstanceActionGates({
      ...base,
      lockedReason: "Sync is running",
    });
    expect(g.reconnect).toEqual({ kind: "allow" });
  });
});
