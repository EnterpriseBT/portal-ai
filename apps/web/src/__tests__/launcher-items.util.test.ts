import { jest } from "@jest/globals";

const { IconName } = await import("@portalai/core/ui");
const {
  LAUNCHER_TYPE_ICON,
  launcherTypeNoun,
  paletteOptions,
  paletteStatusText,
} = await import("../utils/launcher-items.util");

describe("launcher items (#1122)", () => {
  it("gives every type the sidebar's icon and a noun", () => {
    expect(LAUNCHER_TYPE_ICON.station).toBe(IconName.SatelliteAlt);
    expect(LAUNCHER_TYPE_ICON.curated_view).toBe(IconName.Layers);
    expect(launcherTypeNoun("pin")).toBe("pinned result");
    expect(launcherTypeNoun("connector_instance")).toBe("connector");
  });

  it("turns groups into options: items as links, actions with their gate", () => {
    const onSelect = jest.fn();
    const gate = { kind: "disable" as const, reason: "Needs member.invite" };
    const options = paletteOptions([
      {
        label: "Actions",
        entries: [
          { kind: "action", id: "invite", label: "Invite", onSelect, gate },
        ],
      },
      {
        label: "Favorites",
        entries: [
          {
            kind: "item",
            id: "s1",
            type: "station",
            name: "Sales",
            href: "/stations/s1",
          },
        ],
      },
      { label: "Recent", entries: [] },
    ]);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      label: "Invite",
      group: "Actions",
      onSelect,
      gate,
    });
    expect(options[1]).toMatchObject({
      label: "Sales",
      group: "Favorites",
      href: "/stations/s1",
    });
  });

  it("keeps an entry listed in two groups distinct", () => {
    const item = {
      kind: "item" as const,
      id: "s1",
      type: "station" as const,
      name: "Sales",
      href: "/stations/s1",
    };
    const [a, b] = paletteOptions([
      { label: "Favorites", entries: [item] },
      { label: "Recent", entries: [item] },
    ]);
    expect(a.id).not.toBe(b.id);
  });

  it("words the live status", () => {
    expect(paletteStatusText(0, true)).toBe("Loading results…");
    expect(paletteStatusText(0, false)).toBe("No results");
    expect(paletteStatusText(1, false)).toBe("1 result");
    expect(paletteStatusText(8, false)).toBe("8 results");
  });
});
