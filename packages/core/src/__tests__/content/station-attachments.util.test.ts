import { describe, it, expect } from "@jest/globals";

import {
  describeStationAttachmentGaps,
  STATION_ATTACHMENT_MISSING_ACTION,
  STATION_ATTACHMENT_NO_ACCESS_ACTION,
  type StationAttachmentCounts,
} from "../../content/station-attachments.util.js";

const counts = (
  views: [number, number],
  connectors: [number, number]
): StationAttachmentCounts => ({
  views: { attached: views[0], readable: views[1] },
  connectors: { attached: connectors[0], readable: connectors[1] },
});

describe("describeStationAttachmentGaps (#674)", () => {
  describe("missing (station-level, the same for every user)", () => {
    it("names both when neither views nor connectors are attached", () => {
      expect(
        describeStationAttachmentGaps(counts([0, 0], [0, 0])).missing
      ).toBe("No views or connectors are attached to this station yet.");
    });

    it("names views when only views are missing", () => {
      expect(
        describeStationAttachmentGaps(counts([0, 0], [2, 2])).missing
      ).toBe("No views are attached to this station yet.");
    });

    it("names connectors when only connectors are missing", () => {
      expect(
        describeStationAttachmentGaps(counts([3, 3], [0, 0])).missing
      ).toBe("No connectors are attached to this station yet.");
    });

    it("is null when both are attached, whatever the caller can read", () => {
      expect(
        describeStationAttachmentGaps(counts([1, 0], [1, 0])).missing
      ).toBeNull();
    });
  });

  describe("noAccess (per-caller, only among attached kinds)", () => {
    it("names both when both are attached and none of either is readable", () => {
      expect(
        describeStationAttachmentGaps(counts([2, 0], [1, 0])).noAccess
      ).toBe(
        "You don't have access to any views or connectors on this station."
      );
    });

    it("names views when attached views are all unreadable", () => {
      expect(
        describeStationAttachmentGaps(counts([2, 0], [1, 1])).noAccess
      ).toBe("You don't have access to any views on this station.");
    });

    it("names connectors when attached connectors are all unreadable", () => {
      expect(
        describeStationAttachmentGaps(counts([2, 1], [3, 0])).noAccess
      ).toBe("You don't have access to any connectors on this station.");
    });

    it("is null when at least one of each attached kind is readable", () => {
      expect(
        describeStationAttachmentGaps(counts([2, 1], [3, 1])).noAccess
      ).toBeNull();
    });

    it("never reports an unattached kind as no-access", () => {
      // No views attached: that's "missing", not "no access".
      expect(describeStationAttachmentGaps(counts([0, 0], [2, 0]))).toEqual({
        missing: "No views are attached to this station yet.",
        noAccess: "You don't have access to any connectors on this station.",
      });
      expect(
        describeStationAttachmentGaps(counts([0, 0], [0, 0])).noAccess
      ).toBeNull();
    });
  });
});

// #676: each gap carries a follow-up sentence. The no-access one says the
// items ARE attached, so an agent relaying it can't turn "no access" into
// "nothing attached".
describe("the follow-up actions (#676)", () => {
  it("tells a missing-attachment reader who can fix it", () => {
    expect(STATION_ATTACHMENT_MISSING_ACTION).toBe(
      "Ask someone who can edit the station to attach them."
    );
  });

  it("says no-access items are attached and points at sharing, not attaching", () => {
    expect(STATION_ATTACHMENT_NO_ACCESS_ACTION).toMatch(/attached/);
    expect(STATION_ATTACHMENT_NO_ACCESS_ACTION).toMatch(
      /shared with your account/
    );
    expect(STATION_ATTACHMENT_NO_ACCESS_ACTION).not.toMatch(/attach them/);
  });
});
