import {
  connectorLockReason,
  joinRunningJobLabels,
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

describe("connectorLockReason (#689)", () => {
  it("is null when nothing is running", () => {
    expect(connectorLockReason([])).toBeNull();
  });

  it("names the running jobs", () => {
    expect(connectorLockReason([{ type: "connector_sync" }])).toBe(
      "Sync is running on this connector — try again when it finishes."
    );
  });
});
