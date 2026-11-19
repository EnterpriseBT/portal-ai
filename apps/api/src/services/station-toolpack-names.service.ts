/**
 * #1063: names for the packs attached to stations.
 *
 * Reading a station conveys what is attached to it, the way a curated view
 * conveys its projection (#829). So a station response names its own packs,
 * and a member who can't list the organization's packs (#630) still sees a
 * custom pack's name rather than `org:<uuid>`.
 *
 * Only ids and names are read (`findNamesByIds`: two columns, org-scoped, no
 * decryption, #1045), and only for refs taken from the stations' own rows, so
 * nothing about a pack beyond its name leaves, and no other pack is named.
 */

import {
  BUILTIN_TOOLPACK_BY_SLUG,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";
import type { AttachedToolpack } from "@portalai/core/contracts";

import { DbService } from "./db.service.js";
import type { DbClient } from "../db/repositories/base.repository.js";

const CUSTOM_PREFIX = "org:";

export class StationToolpackNamesService {
  /**
   * Each station's refs as named packs, with one name lookup for all of
   * them. Order follows the refs. A built-in slug the registry no longer
   * knows keeps its slug as its name; a custom ref with no live pack in the
   * organization gets no item.
   */
  static async forStations(
    organizationId: string,
    refsByStation: ReadonlyMap<string, readonly string[]>,
    client?: DbClient
  ): Promise<Map<string, AttachedToolpack[]>> {
    const customIds = new Set<string>();
    for (const refs of refsByStation.values()) {
      for (const ref of refs) {
        if (ref.startsWith(CUSTOM_PREFIX)) {
          customIds.add(ref.slice(CUSTOM_PREFIX.length));
        }
      }
    }
    const names = new Map<string, string>();
    if (customIds.size > 0) {
      const rows =
        await DbService.repository.organizationToolpacks.findNamesByIds(
          [...customIds],
          { organizationId },
          client
        );
      for (const row of rows) names.set(row.id, row.name);
    }

    const result = new Map<string, AttachedToolpack[]>();
    for (const [stationId, refs] of refsByStation) {
      const packs: AttachedToolpack[] = [];
      for (const ref of refs) {
        if (ref.startsWith(CUSTOM_PREFIX)) {
          const name = names.get(ref.slice(CUSTOM_PREFIX.length));
          if (name !== undefined) packs.push({ ref, kind: "custom", name });
        } else {
          packs.push({
            ref,
            kind: "builtin",
            name: isBuiltinToolpackSlug(ref)
              ? BUILTIN_TOOLPACK_BY_SLUG[ref].name
              : ref,
          });
        }
      }
      result.set(stationId, packs);
    }
    return result;
  }

  /** One station's refs as named packs. */
  static async forRefs(
    organizationId: string,
    refs: readonly string[],
    client?: DbClient
  ): Promise<AttachedToolpack[]> {
    const named = await StationToolpackNamesService.forStations(
      organizationId,
      new Map([["", refs]]),
      client
    );
    return named.get("") ?? [];
  }
}
