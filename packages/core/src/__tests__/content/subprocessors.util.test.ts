import {
  RESIDENCY_SUBPROCESSOR_NOTE,
  SUBPROCESSORS,
  SUBPROCESSOR_IDS,
  WEBHOOK_NOT_SUBPROCESSOR_NOTE,
} from "../../content/subprocessors.util.js";

// The public subprocessor list (#613). It renders on the marketing site's
// /security/ and privacy pages; `subprocessor-egress-parity.test.ts` in
// apps/api holds it to the env vars the API actually reads.

const SENTENCE = /[.!?]$/;

describe("SUBPROCESSORS", () => {
  it("has exactly one entry per id", () => {
    expect(SUBPROCESSORS.map((s) => s.id).sort()).toEqual(
      [...SUBPROCESSOR_IDS].sort()
    );
  });

  it("gives every entry a name and a purpose sentence", () => {
    for (const s of SUBPROCESSORS) {
      expect(s.name.trim()).not.toBe("");
      expect(s.purpose).toMatch(SENTENCE);
    }
  });

  it("marks hosting as always in use and tool vendors as conditional", () => {
    // AWS runs every request; Tavily and Mapbox only see data when a portal
    // question invokes their tool. Saying otherwise overstates or understates
    // what a customer's data reaches.
    const byId = new Map(SUBPROCESSORS.map((s) => [s.id, s]));
    expect(byId.get("aws")?.usedWhen).toBeNull();
    expect(byId.get("tavily")?.usedWhen).toEqual(expect.any(String));
    expect(byId.get("mapbox")?.usedWhen).toEqual(expect.any(String));
  });

  it("never phrases a condition as a sentence of its own", () => {
    // Pages render `usedWhen` as "Used <usedWhen>." after the purpose, so it
    // starts lower-case and carries no period of its own.
    for (const s of SUBPROCESSORS) {
      if (s.usedWhen === null) continue;
      expect(s.usedWhen).toMatch(/^[a-z]/);
      expect(s.usedWhen).not.toMatch(SENTENCE);
    }
  });
});

describe("where each subprocessor is reached from", () => {
  // The API's env-var guard (apps/api) covers "server" entries and the web
  // app's host guard (apps/web) covers "browser" ones; an entry neither can
  // reach would be checked by nothing.
  it("names at least one side for every entry", () => {
    for (const s of SUBPROCESSORS) {
      expect(s.reachedBy.length).toBeGreaterThan(0);
      for (const side of s.reachedBy) {
        expect(["server", "browser"]).toContain(side);
      }
    }
  });

  it("lists the browser-loaded map tile providers", () => {
    // CARTO is every portal map's default basemap and OpenStreetMap its
    // fallback; both receive the viewer's IP and the map area on screen.
    const byId = new Map(SUBPROCESSORS.map((s) => [s.id, s]));
    expect(byId.get("carto")?.reachedBy).toEqual(["browser"]);
    expect(byId.get("openstreetmap")?.reachedBy).toEqual(["browser"]);
  });
});

describe("subprocessor notes", () => {
  it("are complete sentences", () => {
    expect(RESIDENCY_SUBPROCESSOR_NOTE).toMatch(SENTENCE);
    expect(WEBHOOK_NOT_SUBPROCESSOR_NOTE).toMatch(SENTENCE);
  });
});
