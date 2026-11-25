import {
  pickLaunchStation,
  stationIdFromPath,
} from "../utils/use-portal-launcher.util";

const PAGE = { id: "p", name: "Page" };
const LAST = { id: "l", name: "Last" };
const FAV = [
  { id: "f1", name: "Alpha" },
  { id: "f2", name: "Beta" },
];

describe("pickLaunchStation (#1075)", () => {
  it("uses the page's station first", () => {
    expect(
      pickLaunchStation({
        pageStation: PAGE,
        lastStation: LAST,
        favoriteStations: FAV,
        settling: true,
      })
    ).toBe(PAGE);
  });

  it("then the last-used station", () => {
    expect(
      pickLaunchStation({
        pageStation: null,
        lastStation: LAST,
        favoriteStations: FAV,
        settling: false,
      })
    ).toBe(LAST);
  });

  it("then the first favorite, when the last-used one is gone", () => {
    expect(
      pickLaunchStation({
        pageStation: null,
        lastStation: null,
        favoriteStations: FAV,
        settling: false,
      })
    ).toBe(FAV[0]);
  });

  it("else none, so the click chooses", () => {
    expect(
      pickLaunchStation({
        pageStation: null,
        lastStation: null,
        favoriteStations: [],
        settling: false,
      })
    ).toBeNull();
  });

  it("names none while a source ahead of the fallback still loads", () => {
    expect(
      pickLaunchStation({
        pageStation: null,
        lastStation: null,
        favoriteStations: FAV,
        settling: true,
      })
    ).toBeNull();
  });
});

describe("stationIdFromPath (#1075)", () => {
  it("reads a station's page and the pages under it", () => {
    expect(stationIdFromPath("/stations/abc")).toBe("abc");
    expect(stationIdFromPath("/stations/abc/settings")).toBe("abc");
  });

  it("is undefined anywhere else", () => {
    expect(stationIdFromPath("/stations")).toBeUndefined();
    expect(stationIdFromPath("/stations/")).toBeUndefined();
    expect(stationIdFromPath("/views/abc")).toBeUndefined();
    expect(stationIdFromPath("/")).toBeUndefined();
  });
});
