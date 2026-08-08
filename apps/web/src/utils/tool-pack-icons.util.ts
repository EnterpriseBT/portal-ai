import type { SvgIconComponent } from "@mui/icons-material";
import AutoGraphOutlined from "@mui/icons-material/AutoGraphOutlined";
import BarChartOutlined from "@mui/icons-material/BarChartOutlined";
import ExtensionOutlined from "@mui/icons-material/ExtensionOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import MapOutlined from "@mui/icons-material/MapOutlined";
import PaidOutlined from "@mui/icons-material/PaidOutlined";
import StorageOutlined from "@mui/icons-material/StorageOutlined";
import TravelExploreOutlined from "@mui/icons-material/TravelExploreOutlined";
import TrendingUpOutlined from "@mui/icons-material/TrendingUpOutlined";

import {
  BUILTIN_TOOLPACK_BY_SLUG,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";

/**
 * The `iconSlug` the API assigns every custom (org-registered) pack —
 * hardcoded server-side in `toolpacks.router.ts`, not user-settable. Custom
 * packs are deliberately uniform, so the puzzle piece is their *declared*
 * icon rather than the thing unmapped packs decay into (#302).
 */
const CUSTOM_PACK_ICON_SLUG = "Extension";

/**
 * MUI icon component for each `iconSlug` declared in the toolpack registry
 * (`BUILTIN_TOOLPACKS`) or assigned to custom packs by the API.
 *
 * Keyed by `iconSlug` — not by pack slug — so the icon a pack *declares* is
 * the icon it *renders*. Before #302 this map was pack-slug-keyed and drifted
 * from the registry silently: `visualize` was missing entirely and fell
 * through to the custom-pack puzzle piece, while three other packs rendered a
 * different icon than they declared. `ToolPackIconUtil.test.ts` guards the
 * invariant — a registry pack whose `iconSlug` has no entry here fails CI.
 *
 * Outlined variants throughout: pack chips are their own visual family,
 * distinct from the filled `IconName` set in `@portalai/core`'s `Icon`.
 */
const ICONS_BY_SLUG: Record<string, SvgIconComponent> = {
  Storage: StorageOutlined,
  AutoGraph: AutoGraphOutlined,
  BarChart: BarChartOutlined,
  TrendingUp: TrendingUpOutlined,
  Paid: PaidOutlined,
  TravelExplore: TravelExploreOutlined,
  Hub: HubOutlined,
  Map: MapOutlined,
  [CUSTOM_PACK_ICON_SLUG]: ExtensionOutlined,
};

export class ToolPackIconUtil {
  /**
   * Resolve a toolpack reference to its MUI icon component.
   *
   * Mirrors `ToolPackUtil.getLabel`: built-in slugs (e.g. `"data_query"`)
   * resolve through the registry's declared `iconSlug`; custom refs
   * (`"org:<uuid>"`) and anything unrecognized get the custom-pack icon.
   */
  static getIcon(pack: string): SvgIconComponent {
    const slug = isBuiltinToolpackSlug(pack)
      ? BUILTIN_TOOLPACK_BY_SLUG[pack].iconSlug
      : CUSTOM_PACK_ICON_SLUG;
    return ICONS_BY_SLUG[slug] ?? ExtensionOutlined;
  }

  /**
   * Canonical icon for custom (user-registered) tool packs. Exists so
   * call sites that already know they're rendering a custom pack
   * don't have to construct a synthetic slug to drive the lookup.
   */
  static getCustomIcon(): SvgIconComponent {
    return ICONS_BY_SLUG[CUSTOM_PACK_ICON_SLUG];
  }
}
