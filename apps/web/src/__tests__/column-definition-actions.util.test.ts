/**
 * #689: a column definition's Edit/Delete. Per-object capabilities first;
 * system rows are refused by the server whatever the caller holds.
 */
import {
  columnDefinitionActionGates,
  SYSTEM_READONLY_REASON,
} from "../utils/column-definition-actions.util";

const all = { read: true, write: true, delete: true };
const none = { read: true, write: false, delete: false };

describe("columnDefinitionActionGates", () => {
  it("allows Edit and Delete on a custom row the caller may change", () => {
    expect(
      columnDefinitionActionGates({ capabilities: all, system: false })
    ).toEqual({ edit: { kind: "allow" }, delete: { kind: "allow" } });
  });

  it("hides both without the permissions", () => {
    expect(
      columnDefinitionActionGates({ capabilities: none, system: false })
    ).toEqual({ edit: { kind: "hide" }, delete: { kind: "hide" } });
  });

  it("shows Edit disabled with the reason on a system row, and no Delete", () => {
    expect(
      columnDefinitionActionGates({ capabilities: all, system: true })
    ).toEqual({
      edit: { kind: "disable", reason: SYSTEM_READONLY_REASON },
      delete: { kind: "hide" },
    });
  });

  it("hides Edit on a system row for a caller who couldn't edit it anyway", () => {
    expect(
      columnDefinitionActionGates({ capabilities: none, system: true }).edit
    ).toEqual({ kind: "hide" });
  });

  it("#769: disables Edit and Delete while a job holds an entity that maps it", () => {
    const reason =
      "Revalidation is running on an entity that uses this column definition — try again when it finishes.";
    expect(
      columnDefinitionActionGates({
        capabilities: all,
        system: false,
        lockedReason: reason,
      })
    ).toEqual({
      edit: { kind: "disable", reason },
      delete: { kind: "disable", reason },
    });
  });

  it("#769: a system row keeps its read-only reason over a job's", () => {
    expect(
      columnDefinitionActionGates({
        capabilities: all,
        system: true,
        lockedReason: "Sync is running",
      }).edit
    ).toEqual({ kind: "disable", reason: SYSTEM_READONLY_REASON });
  });
});
