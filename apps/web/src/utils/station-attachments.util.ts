import type { StationGetResponsePayload } from "@portalai/core/contracts";

import type { StationAttachmentListItem } from "../components/StationAttachmentList.component";

type StationWithAttachments = Pick<
  StationGetResponsePayload["station"],
  "instances" | "views"
>;

/**
 * #674: a station GET's attachments as chip items, readable or not. An
 * unreadable attachment keeps its real name (the server returns it); the id
 * is the last-resort label when the object is gone.
 */
export function toStationAttachmentItems(station: StationWithAttachments): {
  connectors: StationAttachmentListItem[];
  views: StationAttachmentListItem[];
} {
  return {
    connectors: (station.instances ?? []).map((inst) => ({
      id: inst.id,
      label: inst.connectorInstance?.name ?? inst.connectorInstanceId,
      canRead: inst.canRead,
    })),
    views: (station.views ?? []).map((v) => ({
      id: v.id,
      label: v.curatedView?.label ?? v.curatedViewId,
      canRead: v.canRead,
    })),
  };
}
