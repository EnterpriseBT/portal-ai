import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import ExtensionOutlined from "@mui/icons-material/ExtensionOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import TravelExploreOutlined from "@mui/icons-material/TravelExploreOutlined";
import TrendingUpOutlined from "@mui/icons-material/TrendingUpOutlined";

import { ToolPackIconUtil } from "../utils/tool-pack-icons.util";

describe("ToolPackIconUtil.getIcon", () => {
  it("returns the dedicated icon component for each known pack", () => {
    expect(ToolPackIconUtil.getIcon("data_query")).toBe(StorageOutlined);
    expect(ToolPackIconUtil.getIcon("statistics")).toBe(BarChartOutlined);
    expect(ToolPackIconUtil.getIcon("regression")).toBe(TrendingUpOutlined);
    expect(ToolPackIconUtil.getIcon("financial")).toBe(PaidOutlined);
    expect(ToolPackIconUtil.getIcon("web_search")).toBe(TravelExploreOutlined);
    expect(ToolPackIconUtil.getIcon("entity_management")).toBe(HubOutlined);
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

  it("returns distinct icons for each known pack", () => {
    const icons = [
      ToolPackIconUtil.getIcon("data_query"),
      ToolPackIconUtil.getIcon("statistics"),
      ToolPackIconUtil.getIcon("regression"),
      ToolPackIconUtil.getIcon("financial"),
      ToolPackIconUtil.getIcon("web_search"),
      ToolPackIconUtil.getIcon("entity_management"),
    ];
    expect(new Set(icons).size).toBe(icons.length);
  });
});
