import React from "react";

import type { PortalListResponsePayload } from "@portalai/core/contracts";
import {
  EmptyState,
  GatedIconButton,
  Icon,
  IconName,
  LinkList,
  type ActionGate,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";

import DataResult from "./DataResult.component";
import { RouterLink } from "./RouterLink.component";
import { sdk } from "../api/sdk";
import { decideActionGate } from "../utils/action-gate.util";

/** A portal row on the dashboard. */
export interface DashboardRecentPortal {
  id: string;
  name: string;
  stationName?: string | null;
  created: number;
  lastOpened: number | null;
  /** Whether the caller may delete it (#688). Omitted = no Delete. */
  deleteGate?: ActionGate;
}

/** How many portals the dashboard shows. It has no "see all". */
export const DASHBOARD_RECENT_PORTALS_MAX = 5;

export interface DashboardRecentPortalsUIProps {
  /** Most recent first. Only the first five are shown. */
  portals: DashboardRecentPortal[];
  /** Opens the delete confirmation for a portal. Without it, no Delete. */
  onDeletePortal?: (portalId: string, portalName: string) => void;
}

/**
 * The dashboard's short Recent portals list (#1123): one line per portal,
 * its name linking to it, with its station and when it was last opened at
 * the trailing edge, and a Delete after the link where the caller may
 * delete it (#1078), or a teaching empty state.
 */
export const DashboardRecentPortalsUI: React.FC<
  DashboardRecentPortalsUIProps
> = ({ portals, onDeletePortal }) => {
  if (portals.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.Portal} />}
        title="No portals yet"
        // Names no control on the page: what starts a portal here changes as
        // the workbench fills in (#1079, #1080).
        description="A portal is a conversation with a station's data. The ones you open most recently show here."
      />
    );
  }

  return (
    <LinkList
      aria-label="Recent portals"
      linkComponent={RouterLink}
      items={portals.slice(0, DASHBOARD_RECENT_PORTALS_MAX).map((portal) => ({
        id: portal.id,
        href: `/portals/${portal.id}`,
        primary: portal.name,
        secondary: [
          portal.stationName,
          DateFactory.relativeTime(portal.lastOpened ?? portal.created),
        ]
          .filter(Boolean)
          .join(" · "),
        // No action at all for a hidden gate, so the row keeps no empty slot.
        action:
          onDeletePortal &&
          portal.deleteGate &&
          portal.deleteGate.kind !== "hide" ? (
            <GatedIconButton
              icon={IconName.Delete}
              size="small"
              color="error"
              // Row actions name their row (#794).
              aria-label={`Delete ${portal.name}`}
              gate={portal.deleteGate}
              onClick={() => onDeletePortal(portal.id, portal.name)}
            />
          ) : undefined,
      }))}
    />
  );
};

export interface DashboardRecentPortalsProps {
  onDeletePortal: (portalId: string, portalName: string) => void;
}

/**
 * The caller's five most recently opened portals (#1078), each with its
 * station, and Delete gated by the portal's own `capabilities.delete`.
 */
export const DashboardRecentPortals: React.FC<DashboardRecentPortalsProps> = ({
  onDeletePortal,
}) => {
  const result = sdk.portals.list({
    limit: DASHBOARD_RECENT_PORTALS_MAX,
    offset: 0,
    sortBy: "lastOpened",
    sortOrder: "desc",
    include: "station",
  });
  return (
    <DataResult results={{ portals: result }}>
      {(data) => {
        const payload = data.portals as unknown as PortalListResponsePayload;
        return (
          <DashboardRecentPortalsUI
            portals={payload.portals.map((portal) => ({
              id: portal.id,
              name: portal.name,
              stationName: portal.stationName,
              created: portal.created,
              lastOpened: portal.lastOpened ?? null,
              deleteGate: decideActionGate({
                allowed: portal.capabilities.delete,
              }),
            }))}
            onDeletePortal={onDeletePortal}
          />
        );
      }}
    </DataResult>
  );
};
