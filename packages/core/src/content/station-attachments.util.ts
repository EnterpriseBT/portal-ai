/**
 * #674: the single source of every empty-station sentence. The web alerts
 * (station detail, portal header), the agent's system prompt and the
 * `platform_help` tool all render from it, so their wording can't drift.
 *
 * Neither views nor connectors gate data access on their own: views give
 * view-scoped data, while connectors give entity data through the
 * entity-management toolpack. So a missing kind is named for what it is,
 * never as "no data".
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

/** Follows a `missing` sentence: who can fix it. */
export const STATION_ATTACHMENT_MISSING_ACTION =
  "Ask someone who can edit the station to attach them.";

/**
 * #676: follows a `noAccess` sentence. It says the items ARE attached: without
 * it, an agent relaying the bare sentence told a user the station had nothing
 * attached and sent them to attach data instead of asking for access.
 */
export const STATION_ATTACHMENT_NO_ACCESS_ACTION =
  "They're attached, but they haven't been shared with your account. Ask someone who can share them to give you access.";

export function describeStationAttachmentGaps(
  c: StationAttachmentCounts
): StationAttachmentGaps {
  const noViews = c.views.attached === 0;
  const noConnectors = c.connectors.attached === 0;
  const missing =
    noViews && noConnectors
      ? "No views or connectors are attached to this station yet."
      : noViews
        ? "No views are attached to this station yet."
        : noConnectors
          ? "No connectors are attached to this station yet."
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
