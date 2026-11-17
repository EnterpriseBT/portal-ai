/**
 * #1036: the agent tools that change which views a station has attached.
 * A portal turn that ran one leaves the station's cached views stale, so the
 * session refreshes `stations` when the turn ends.
 */
export const STATION_ATTACHMENT_TOOLS = [
  "curated_view_attach",
  "curated_view_detach",
] as const;

/** Whether a turn that ran `toolNames` may have changed a station's views. */
export const changedStationAttachments = (
  toolNames: ReadonlySet<string>
): boolean => STATION_ATTACHMENT_TOOLS.some((name) => toolNames.has(name));
