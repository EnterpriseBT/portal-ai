import {
  STATION_ATTACHMENT_TOOLS,
  changedStationAttachments,
} from "../utils/station-attachment-tools.util";

// #1036: a portal turn that attached or detached a view changed the station,
// so the station's cached views must refresh when the turn ends.
describe("changedStationAttachments (#1036)", () => {
  it("names the two tools that change a station's views", () => {
    expect([...STATION_ATTACHMENT_TOOLS]).toEqual([
      "curated_view_attach",
      "curated_view_detach",
    ]);
  });

  it.each(["curated_view_attach", "curated_view_detach"])(
    "is true for a turn that ran %s",
    (name) => {
      expect(changedStationAttachments(new Set(["sql_query", name]))).toBe(
        true
      );
    }
  );

  it("is false for a turn that only read or managed views", () => {
    expect(
      changedStationAttachments(
        new Set(["sql_query", "curated_view_create", "station_list"])
      )
    ).toBe(false);
    expect(changedStationAttachments(new Set())).toBe(false);
  });
});
