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

/**
 * #1055: names the organization's own packs in the plan sentence. The web
 * passes it among `excludedPackNames` when the plan excludes custom packs.
 */
export const STATION_PLAN_EXCLUDED_CUSTOM_PACKS =
  "Your organization's tool packs";

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
 * "and N more" (N is at least 2). The organization's packs are always named:
 * in a cut list they take the third place.
 */
function listPacks(names: readonly string[]): string {
  let shown = [...names];
  let rest = 0;
  if (names.length > 4) {
    const custom = names.includes(STATION_PLAN_EXCLUDED_CUSTOM_PACKS);
    const others = names.filter(
      (n) => n !== STATION_PLAN_EXCLUDED_CUSTOM_PACKS
    );
    shown = custom
      ? [...others.slice(0, 2), STATION_PLAN_EXCLUDED_CUSTOM_PACKS]
      : others.slice(0, 3);
    rest = names.length - shown.length;
  }
  shown = shown.map((name, i) =>
    i > 0 && name === STATION_PLAN_EXCLUDED_CUSTOM_PACKS
      ? name.charAt(0).toLowerCase() + name.slice(1)
      : name
  );
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * #1055: the plan excludes every pack on the station whose tools would read
 * its records, so attaching a view changes nothing. Names those packs.
 */
function planExcludedSentence(names: readonly string[]): string {
  const subject =
    names.length > 0 ? listPacks(names) : "Some tool packs on this station";
  // "Your organization's tool packs" is plural on its own.
  const singular =
    names.length === 1 && names[0] !== STATION_PLAN_EXCLUDED_CUSTOM_PACKS;
  const verb = singular ? "isn't" : "aren't";
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
