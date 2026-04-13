import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import HandymanOutlined from "@mui/icons-material/HandymanOutlined";
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

  it("falls back to a generic tool icon for unknown packs", () => {
    expect(ToolPackIconUtil.getIcon("unknown_pack")).toBe(HandymanOutlined);
    expect(ToolPackIconUtil.getIcon("")).toBe(HandymanOutlined);
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
