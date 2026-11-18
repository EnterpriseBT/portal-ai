import { describe, it, expect } from "@jest/globals";

import {
  describeStationAttachmentGaps,
  STATION_ATTACHMENT_MISSING_ACTION,
  STATION_ATTACHMENT_NO_ACCESS_ACTION,
  STATION_PLAN_EXCLUDED_CUSTOM_PACKS,
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
      ).toBe(
        "No views or connectors are attached to this station. It works without them. Attach a view to query entity data here, or a connector to create and edit entities."
      );
    });

    it("names views when only views are missing", () => {
      expect(
        describeStationAttachmentGaps(counts([0, 0], [2, 2])).missing
      ).toBe(
        "No views are attached to this station. Attach a view to query entity data here."
      );
    });

    it("names connectors when only connectors are missing", () => {
      expect(
        describeStationAttachmentGaps(counts([3, 3], [0, 0])).missing
      ).toBe(
        "No connectors are attached to this station. Attach a connector to create and edit entities here."
      );
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
        missing:
          "No views are attached to this station. Attach a view to query entity data here.",
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
  it("tells a missing-attachment reader who can attach one (#848)", () => {
    expect(STATION_ATTACHMENT_MISSING_ACTION).toBe(
      "Anyone who can edit the station can attach them."
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

// #1055: when the plan excludes every pack on the station whose tools would
// read its records, the plan is the reason, not a missing view. The sentence
// names those packs and never suggests attaching.
describe("describeStationAttachmentGaps — plan-excluded (#1055)", () => {
  const all = [
    counts([0, 0], [0, 0]),
    counts([0, 0], [2, 2]),
    counts([2, 2], [0, 0]),
    counts([2, 2], [2, 2]),
    counts([2, 0], [2, 0]),
  ];

  it.each(["usable", "none", undefined] as const)(
    "leaves the output unchanged for %s",
    (dataSetup) => {
      for (const c of all) {
        expect(
          describeStationAttachmentGaps(c, {
            dataSetup,
            excludedPackNames: ["GIS"],
          })
        ).toEqual(describeStationAttachmentGaps(c));
      }
    }
  );

  it("names the pack instead of suggesting a view, whatever the counts", () => {
    for (const c of [counts([0, 0], [0, 0]), counts([2, 2], [2, 2])]) {
      expect(
        describeStationAttachmentGaps(c, {
          dataSetup: "plan-excluded",
          excludedPackNames: ["GIS"],
        }).missing
      ).toBe(
        "GIS isn't included in your plan, so attaching a view won't make data available on this station."
      );
    }
  });

  const missingFor = (names: string[]) =>
    describeStationAttachmentGaps(counts([0, 0], [2, 2]), {
      dataSetup: "plan-excluded",
      excludedPackNames: names,
    }).missing;

  it.each([
    [["Data Query", "GIS"], "Data Query and GIS aren't"],
    [
      ["Data Query", "Statistics", "GIS"],
      "Data Query, Statistics and GIS aren't",
    ],
    [
      ["Data Query", "Statistics", "Regression", "GIS"],
      "Data Query, Statistics, Regression and GIS aren't",
    ],
    [
      ["Data Query", "Statistics", "Regression", "Financial", "GIS"],
      "Data Query, Statistics, Regression and 2 more aren't",
    ],
  ])("lists %j", (names, start) => {
    expect(missingFor(names)).toBe(
      `${start} included in your plan, so attaching a view won't make data available on this station.`
    );
  });

  it("falls back to a general subject with no names", () => {
    expect(missingFor([])).toBe(
      "Some tool packs on this station aren't included in your plan, so attaching a view won't make data available on this station."
    );
  });

  it("reads the organization's packs lowercase after another name", () => {
    expect(missingFor([STATION_PLAN_EXCLUDED_CUSTOM_PACKS])).toMatch(
      /^Your organization's tool packs aren't included/
    );
    expect(missingFor(["GIS", STATION_PLAN_EXCLUDED_CUSTOM_PACKS])).toMatch(
      /^GIS and your organization's tool packs aren't included/
    );
  });

  // A cut list keeps the organization's packs named, not folded into the count.
  it("keeps the organization's packs named when the list is cut", () => {
    expect(
      missingFor([
        "Data Query",
        "Statistics",
        "Regression",
        "GIS",
        STATION_PLAN_EXCLUDED_CUSTOM_PACKS,
      ])
    ).toMatch(
      /^Data Query, Statistics, your organization's tool packs and 2 more aren't included/
    );
  });

  it("leaves noAccess unchanged", () => {
    const c = counts([2, 0], [2, 0]);
    expect(
      describeStationAttachmentGaps(c, {
        dataSetup: "plan-excluded",
        excludedPackNames: ["GIS"],
      }).noAccess
    ).toBe(describeStationAttachmentGaps(c).noAccess);
  });
});
