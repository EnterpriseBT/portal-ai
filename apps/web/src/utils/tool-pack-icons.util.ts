import type { SvgIconComponent } from "@mui/icons-material";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import ExtensionOutlined from "@mui/icons-material/ExtensionOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import TravelExploreOutlined from "@mui/icons-material/TravelExploreOutlined";
import TrendingUpOutlined from "@mui/icons-material/TrendingUpOutlined";

/**
 * MUI icon component for each known tool pack. Custom (user-registered)
 * packs share a single Extension icon — matches the server-side
 * `iconSlug: "Extension"` and the puzzle-piece convention used for
 * custom integrations across the app.
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
   * Resolve a tool pack key to its MUI icon component. Built-in packs
   * map to their domain icon; everything else (custom packs, future
   * built-ins not yet in the map) falls back to the Extension icon.
   */
  static getIcon(pack: string): SvgIconComponent {
    return TOOL_PACK_ICONS[pack] ?? ExtensionOutlined;
  }

  /**
   * Canonical icon for custom (user-registered) tool packs. Exists so
   * call sites that already know they're rendering a custom pack
   * don't have to construct a synthetic slug to drive the fallback.
   */
  static getCustomIcon(): SvgIconComponent {
    return ExtensionOutlined;
  }
}
