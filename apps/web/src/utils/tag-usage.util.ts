import type { TagUsage } from "@portalai/core/contracts";
import { TAG_TARGET_TYPES, type TagTargetType } from "@portalai/core/models";

/** Each taggable type's noun, singular and plural. Also names a launcher
 *  item's type (#1122). */
export const TAG_TARGET_NOUNS: Record<TagTargetType, [string, string]> = {
  entity: ["entity", "entities"],
  station: ["station", "stations"],
  pin: ["pinned result", "pinned results"],
  connector_instance: ["connector", "connectors"],
  curated_view: ["view", "views"],
};

/**
 * A tag's usage as one line (#1070): "4 entities · 2 views", or "Not used".
 * The counts cover only objects the caller can read.
 */
export function formatTagUsage(usage: TagUsage): string {
  const parts = TAG_TARGET_TYPES.filter((type) => usage[type] > 0).map(
    (type) => {
      const n = usage[type];
      return `${n} ${TAG_TARGET_NOUNS[type][n === 1 ? 0 : 1]}`;
    }
  );
  return parts.length > 0 ? parts.join(" · ") : "Not used";
}
