import { jest } from "@jest/globals";

const { IconName } = await import("@portalai/core/ui");
const {
  LAUNCHER_TYPE_ICON,
  launcherTypeNoun,
  paletteOptions,
  paletteStatusText,
  parsePaletteQuery,
  toLauncherItem,
  RESULT_GROUP_LABEL,
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

  it("gives portals an icon, a noun and a heading (#1076)", () => {
    expect(LAUNCHER_TYPE_ICON.portal).toBe(IconName.Portal);
    expect(launcherTypeNoun("portal")).toBe("portal");
    expect(RESULT_GROUP_LABEL.portal).toBe("Portals");
    expect(RESULT_GROUP_LABEL.pin).toBe("Pinned results");
  });

  it("reads the palette's text as home, a search or a tag search (#1076)", () => {
    expect(parsePaletteQuery("")).toEqual({ mode: "home" });
    expect(parsePaletteQuery("   ")).toEqual({ mode: "home" });
    expect(parsePaletteQuery(" sales ops ")).toEqual({
      mode: "search",
      text: "sales ops",
    });
    expect(parsePaletteQuery("#finance")).toEqual({
      mode: "tag",
      text: "finance",
    });
    expect(parsePaletteQuery(" #  fin ")).toEqual({ mode: "tag", text: "fin" });
    expect(parsePaletteQuery("#")).toEqual({ mode: "tag", text: "" });
  });

  it("links each result type to its detail page (#1076)", () => {
    const routes = {
      station: "/stations/x 1",
      pin: "/portal-results/x 1",
      curated_view: "/views/x 1",
      connector_instance: "/connectors/x 1",
      entity: "/entities/x 1",
      portal: "/portals/x 1",
    } as const;
    for (const [type, path] of Object.entries(routes)) {
      const item = toLauncherItem({
        type: type as keyof typeof routes,
        id: "x 1",
        name: "X",
        tags: [{ id: "t", name: "Fin", color: null }],
      });
      expect(item.href).toBe(path.replace(" ", "%20"));
      expect(item.tags).toEqual([{ id: "t", name: "Fin", color: null }]);
    }
  });

  it("passes a link action's href and gate through (#1076)", () => {
    const gate = { kind: "disable" as const, reason: "Ask for access" };
    const [option] = paletteOptions([
      {
        label: "Actions",
        entries: [
          {
            kind: "action",
            id: "new-station",
            label: "New station",
            href: "/stations?create=station",
            gate,
          },
        ],
      },
    ]);
    expect(option).toMatchObject({
      href: "/stations?create=station",
      gate,
      label: "New station",
    });
    expect(option.onSelect).toBeUndefined();
  });
});
