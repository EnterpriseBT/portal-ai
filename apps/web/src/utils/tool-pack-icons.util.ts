import type { SvgIconComponent } from "@mui/icons-material";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import HandymanOutlined from "@mui/icons-material/HandymanOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import TravelExploreOutlined from "@mui/icons-material/TravelExploreOutlined";
import TrendingUpOutlined from "@mui/icons-material/TrendingUpOutlined";

/**
 * MUI icon component for each known tool pack. Falls back to a generic
 * tool icon for unknown packs so future server-side additions still render.
 */
const TOOL_PACK_ICONS: Record<string, SvgIconComponent> = {
  data_query: StorageOutlined,
  statistics: BarChartOutlined,
  regression: TrendingUpOutlined,
  financial: PaidOutlined,
  web_search: TravelExploreOutlined,
  entity_management: HubOutlined,
};

export class ToolPackIconUtil {
  /**
   * Resolve a tool pack key to its MUI icon component, falling back to a
   * generic tool icon for unknown packs.
   */
  static getIcon(pack: string): SvgIconComponent {
    return TOOL_PACK_ICONS[pack] ?? HandymanOutlined;
  }
}
