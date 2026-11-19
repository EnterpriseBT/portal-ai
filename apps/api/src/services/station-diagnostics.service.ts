/**
 * Station diagnostics (#1050): what can be said about why a station returns
 * thin or empty answers — its packs, whether views and connectors are
 * attached and readable by the caller, whether records exist, and what the
 * plan excludes. Read once here for both `platform_help` (the help pack, which
 * turns it into guidance) and `station_context` (always available, which
 * reports it as `status`), so the two never describe a station differently.
 * Moved out of `platform-help.tool.ts` (#367, #674, #848, #1045) unchanged.
 */
import { describeStationAttachmentGaps } from "@portalai/core/content";
import {
  stationDataSetup,
  type StationDataSetup,
} from "@portalai/core/registries";

import { DbService } from "./db.service.js";
import { AnalyticsService } from "./analytics.service.js";
import { EntitlementService } from "./entitlement.service.js";
import { StationAttachmentService } from "./station-attachment.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "station-diagnostics" });

export interface StationFindings {
  /** False when the station read failed — the answer degrades, never errors. */
  available: boolean;
  hasPacks: boolean;
  /** #1050: the built-in packs whose tools exist in this session. */
  packsEffective: string[];
  /** #848, #1045: how the station stands with entity data. */
  dataSetup: StationDataSetup;
  /**
   * #1045: the packs attached here that the plan excludes, as the answer
   * lists them, or null when there are none. Built-in slugs first; custom
   * packs under their own label, since one can share a built-in pack's slug.
   */
  excludedPacks: string | null;
  entityCount: number;
  recordCount: number;
  /** #674: the station-level gap (null when both kinds are attached). */
  attachmentsMissing: string | null;
  /** #674: the caller-level gap (null when they can read something of each attached kind). */
  attachmentsNoAccess: string | null;
}

/** `unknown`: the station couldn't be read, so nothing can be said. */
export type StationSituation =
  | "no_packs"
  | "attachments_missing"
  | "attachments_inaccessible"
  | "no_records"
  | "unentitled_packs"
  | "default"
  | "unknown";

export class StationDiagnosticsService {
  /**
   * Read what this station can be said about. Fail-soft by contract: any failure
   * degrades the answer instead of erroring, because this is the surface a stuck
   * user reaches for.
   */
  static async forStation(
    stationId: string,
    organizationId: string,
    userId: string
  ): Promise<StationFindings> {
    try {
      const repo = DbService.repository;

      // The one derivation of a station's packs (#306), which the system
      // prompt reads too: a second copy here classified a station with a custom
      // pack differently from the prompt in the same session. The split only:
      // this answer needs the names of custom packs the plan excludes, which
      // the split carries, and none of their details.
      const {
        effective,
        unentitled,
        configuredCustomPackCount,
        customPacksEntitled,
        excludedCustomPacks,
      } = await EntitlementService.resolveStationPackSplit(
        stationId,
        organizationId
      );
      const hasPacks =
        effective.length + unentitled.length + configuredCustomPackCount > 0;
      // The same derivation the prompt uses. An excluded custom pack counts by
      // its resolved name, as it does there: an attachment whose pack row is
      // gone names nothing and classifies nothing.
      const dataSetup = stationDataSetup({
        effective,
        unentitled,
        hasUsableCustomPack:
          customPacksEntitled && configuredCustomPackCount > 0,
        hasExcludedCustomPack: excludedCustomPacks.length > 0,
      });

      // Org-scoped, exactly as `station_context` reads.
      const stationData = await AnalyticsService.loadStation(
        stationId,
        organizationId
      );
      const entityIds = stationData.entities.map((e: { id: string }) => e.id);

      // One bounded aggregate — never a row scan. A station's entities can be
      // arbitrarily large, and all this answer needs is presence.
      const recordCount =
        entityIds.length > 0
          ? await repo.entityRecords.countByConnectorEntityIds(entityIds)
          : 0;

      const gaps = describeStationAttachmentGaps(
        await StationAttachmentService.countsForCaller(
          stationId,
          organizationId,
          userId
        )
      );

      return {
        available: true,
        hasPacks,
        packsEffective: effective,
        dataSetup,
        excludedPacks: describeExcludedPacks(unentitled, excludedCustomPacks),
        entityCount: entityIds.length,
        recordCount,
        attachmentsMissing: gaps.missing,
        attachmentsNoAccess: gaps.noAccess,
      };
    } catch (error) {
      logger.warn(
        { stationId, organizationId, error },
        "station diagnostics could not read station state; reporting it as unknown"
      );
      return {
        available: false,
        hasPacks: true,
        packsEffective: [],
        dataSetup: "usable",
        excludedPacks: null,
        entityCount: 0,
        recordCount: 0,
        attachmentsMissing: null,
        attachmentsNoAccess: null,
      };
    }
  }

  /** First hit wins — ordered from "nothing works" to "everything works". */
  static situation(findings: StationFindings): StationSituation {
    if (!findings.available) return "unknown";
    if (!findings.hasPacks) return "no_packs";
    // #1045: every data-capable pack here is excluded by the plan. That is
    // the answer; attaching or sharing data would change nothing.
    if (findings.dataSetup === "plan-excluded") return "unentitled_packs";
    // #848: missing views or connectors only explain an empty answer on a
    // station with a usable pack that works on attached data.
    if (findings.dataSetup === "usable" && findings.attachmentsMissing) {
      return "attachments_missing";
    }
    if (findings.attachmentsNoAccess) return "attachments_inaccessible";
    // "Entities set up, nothing imported" needs entities to be true.
    if (findings.entityCount > 0 && findings.recordCount === 0) {
      return "no_records";
    }
    if (findings.excludedPacks) return "unentitled_packs";
    return "default";
  }
}

/**
 * The packs the plan excludes, as one list for the answer's brackets:
 * `gis, statistics; registered by your organization: acme, crm`. Custom packs
 * sit under one label. One can be registered under a built-in pack's slug,
 * and the two are different things to the reader.
 */
function describeExcludedPacks(
  builtinSlugs: readonly string[],
  customNames: readonly string[]
): string | null {
  const parts = [
    ...(builtinSlugs.length > 0 ? [builtinSlugs.join(", ")] : []),
    ...(customNames.length > 0
      ? [`registered by your organization: ${customNames.join(", ")}`]
      : []),
  ];
  return parts.length > 0 ? parts.join("; ") : null;
}
