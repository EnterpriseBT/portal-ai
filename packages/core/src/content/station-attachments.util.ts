/**
 * #674: the single source of every empty-station sentence. The web alerts
 * (station detail, portal header), the agent's system prompt and the
 * `platform_help` tool all render from it, so their wording can't drift.
 *
 * Neither views nor connectors gate data access on their own: views give
 * view-scoped data, while connectors give entity data through the
 * entity-management toolpack. So a missing kind is named for what it is,
 * never as "no data".
 *
 * #848: a station with neither is valid. A station set up for access work
 * (the provisioned Administrate station) attaches no data on purpose, so a
 * `missing` sentence says what attaching the kind would add rather than
 * reading as something left unfinished.
 */

export interface StationAttachmentCounts {
  /** `attached`: the station-level count. `readable`: how many of those the
   *  caller has `read` on. */
  views: { attached: number; readable: number };
  connectors: { attached: number; readable: number };
}

export interface StationAttachmentGaps {
  /** Station-level, so identical for every user. Null when both kinds are attached. */
  missing: string | null;
  /** Per-caller, and only among the kinds that ARE attached: the caller can
   *  read none of them. Null otherwise. */
  noAccess: string | null;
}

/** Follows a `missing` sentence: who can attach one. */
export const STATION_ATTACHMENT_MISSING_ACTION =
  "Anyone who can edit the station can attach them.";

/**
 * #676: follows a `noAccess` sentence. It says the items ARE attached: without
 * it, an agent relaying the bare sentence told a user the station had nothing
 * attached and sent them to attach data instead of asking for access.
 */
export const STATION_ATTACHMENT_NO_ACCESS_ACTION =
  "They're attached, but they haven't been shared with your account. Ask someone who can share them to give you access.";

export interface StationAttachmentGapsOptions {
  /**
   * How the station stands with entity data. It repeats `StationDataSetup`
   * from `@portalai/core/registries`, which content can't import; a test
   * there holds the two equal.
   */
  dataSetup?: "usable" | "plan-excluded" | "none";
  /** The plan-excluded packs whose tools would read the station's records,
   *  by display name, in the order to name them. */
  excludedPackNames?: readonly string[];
}

/**
 * "A", "A and B", … up to four names; beyond that the first three and
 * "and N more" (N is at least 2).
 */
function listPacks(names: readonly string[]): string {
  if (names.length > 4) {
    return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  }
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * #1055: the plan excludes every pack on the station whose tools would read
 * its records, so attaching a view changes nothing. Names those packs.
 */
function planExcludedSentence(names: readonly string[]): string {
  const subject =
    names.length > 0 ? listPacks(names) : "Some tool packs on this station";
  const verb = names.length === 1 ? "isn't" : "aren't";
  return `${subject} ${verb} included in your plan, so attaching a view won't make data available on this station.`;
}

export function describeStationAttachmentGaps(
  c: StationAttachmentCounts,
  options: StationAttachmentGapsOptions = {}
): StationAttachmentGaps {
  const noViews = c.views.attached === 0;
  const noConnectors = c.connectors.attached === 0;
  const missing =
    options.dataSetup === "plan-excluded"
      ? planExcludedSentence(options.excludedPackNames ?? [])
      : noViews && noConnectors
        ? "No views or connectors are attached to this station. It works without them. Attach a view to query entity data here, or a connector to create and edit entities."
        : noViews
          ? "No views are attached to this station. Attach a view to query entity data here."
          : noConnectors
            ? "No connectors are attached to this station. Attach a connector to create and edit entities here."
            : null;

  const viewsLocked = !noViews && c.views.readable === 0;
  const connectorsLocked = !noConnectors && c.connectors.readable === 0;
  const noAccess =
    viewsLocked && connectorsLocked
      ? "You don't have access to any views or connectors on this station."
      : viewsLocked
        ? "You don't have access to any views on this station."
        : connectorsLocked
          ? "You don't have access to any connectors on this station."
          : null;

  return { missing, noAccess };
}
