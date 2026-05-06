import {
  BUILTIN_TOOLPACK_BY_SLUG,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";

export class ToolPackUtil {
  /**
   * Resolve a toolpack slug to its display label, falling back to the
   * raw slug for unknown values (e.g. a custom-pack slug not yet
   * registered or a stale row).
   */
  static getLabel(pack: string): string {
    if (isBuiltinToolpackSlug(pack)) {
      return BUILTIN_TOOLPACK_BY_SLUG[pack].name;
    }
    return pack;
  }
}
