import AutoGraphOutlined from "@mui/icons-material/AutoGraphOutlined";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import ExtensionOutlined from "@mui/icons-material/ExtensionOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import MapOutlined from "@mui/icons-material/MapOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import TravelExploreOutlined from "@mui/icons-material/TravelExploreOutlined";
import TrendingUpOutlined from "@mui/icons-material/TrendingUpOutlined";

import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";

import { ToolPackIconUtil } from "../utils/tool-pack-icons.util";

describe("ToolPackIconUtil.getIcon", () => {
  it("returns the dedicated icon component for each known pack", () => {
    expect(ToolPackIconUtil.getIcon("data_query")).toBe(StorageOutlined);
    expect(ToolPackIconUtil.getIcon("visualize")).toBe(AutoGraphOutlined);
    expect(ToolPackIconUtil.getIcon("statistics")).toBe(BarChartOutlined);
    expect(ToolPackIconUtil.getIcon("regression")).toBe(TrendingUpOutlined);
    expect(ToolPackIconUtil.getIcon("financial")).toBe(PaidOutlined);
    expect(ToolPackIconUtil.getIcon("web_search")).toBe(TravelExploreOutlined);
    expect(ToolPackIconUtil.getIcon("entity_management")).toBe(HubOutlined);
    expect(ToolPackIconUtil.getIcon("gis")).toBe(MapOutlined);
  });

  it("falls back to the Extension icon for unknown / custom packs", () => {
    expect(ToolPackIconUtil.getIcon("unknown_pack")).toBe(ExtensionOutlined);
    expect(ToolPackIconUtil.getIcon("")).toBe(ExtensionOutlined);
    // Custom packs use `org:<id>` refs and share the Extension icon
    // for visual parity with built-in chips in the station picker.
    expect(ToolPackIconUtil.getIcon("org:abc-123")).toBe(ExtensionOutlined);
  });

  it("getCustomIcon returns the same Extension icon as the unknown-slug fallback", () => {
    expect(ToolPackIconUtil.getCustomIcon()).toBe(ExtensionOutlined);
    expect(ToolPackIconUtil.getCustomIcon()).toBe(
      ToolPackIconUtil.getIcon("org:any")
    );
  });
});

// ── Registry coverage guard (#302) ───────────────────────────────────
//
// Derived from BUILTIN_TOOLPACKS rather than a hand-written list: the
// hand-written version is what let #269 ship the `visualize` pack with no
// icon entry, silently rendering the custom-pack puzzle piece. Any pack
// added to the registry without a matching icon now fails here.
describe("built-in icon coverage", () => {
  it("resolves every registry pack to a real icon, never the custom-pack fallback", () => {
    const custom = ToolPackIconUtil.getCustomIcon();
    const unmapped = BUILTIN_TOOLPACKS.filter(
      (pack) => ToolPackIconUtil.getIcon(pack.slug) === custom
    ).map((pack) => `${pack.slug} (iconSlug: ${pack.iconSlug})`);

    expect(unmapped).toEqual([]);
  });

  it("gives every registry pack a distinct icon", () => {
    const icons = BUILTIN_TOOLPACKS.map((pack) =>
      ToolPackIconUtil.getIcon(pack.slug)
    );

    expect(new Set(icons).size).toBe(BUILTIN_TOOLPACKS.length);
  });
});
