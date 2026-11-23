import { formatTagUsage } from "../utils/tag-usage.util";

const none = {
  entity: 0,
  station: 0,
  pin: 0,
  connector_instance: 0,
  curated_view: 0,
};

describe("formatTagUsage (#1070)", () => {
  it("names each type in use, in a fixed order", () => {
    expect(
      formatTagUsage({ ...none, curated_view: 2, entity: 4, pin: 1 })
    ).toBe("4 entities · 1 pinned result · 2 views");
  });

  it("uses the singular for one", () => {
    expect(formatTagUsage({ ...none, station: 1, connector_instance: 1 })).toBe(
      "1 station · 1 connector"
    );
  });

  it("says when a tag is on nothing", () => {
    expect(formatTagUsage(none)).toBe("Not used");
  });
});
