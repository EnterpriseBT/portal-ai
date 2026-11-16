import React from "react";

import type { PortalListResponsePayload } from "@portalai/core/contracts";
import {
  CardList,
  DetailCard,
  Icon,
  IconName,
  Stack,
  Typography,
} from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import DeleteIcon from "@mui/icons-material/Delete";

import DataResult from "./DataResult.component";
import { RouterLink } from "./RouterLink.component";
import { sdk } from "../api/sdk";
import { decideActionGate } from "../utils/action-gate.util";

// ── Pure UI ─────────────────────────────────────────────────────────

export interface RecentPortalsListUIProps {
  /** List rows, each with the caller's `capabilities` (#688). */
  portals: PortalListResponsePayload["portals"];
  onDeletePortal: (portalId: string, portalName: string) => void;
}

export const RecentPortalsListUI: React.FC<RecentPortalsListUIProps> = ({
  portals,
  onDeletePortal,
}) => {
  if (portals.length === 0) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ py: 4, textAlign: "center" }}
        data-testid="empty-portals"
      >
        No portals yet — open a station to start your first conversation.
      </Typography>
    );
  }

  return (
    <CardList aria-label="Recent portals">
      {portals.map((portal) => {
        const actions: ActionSuiteItem[] = [
          {
            label: "Delete",
            icon: <DeleteIcon />,
            color: "error",
            onClick: () => onDeletePortal(portal.id, portal.name),
            // #690: only on portals the caller may delete.
            gate: decideActionGate({ allowed: portal.capabilities.delete }),
          },
        ];

        return (
          <DetailCard
            key={portal.id}
            title={portal.name}
            // #794: the card opens its portal through its title's link.
            href={`/portals/${portal.id}`}
            linkComponent={RouterLink}
            actions={actions}
            data-testid={`portal-row-${portal.id}`}
          >
            <Stack spacing={0.25}>
              {portal.stationName && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Icon
                    name={IconName.SatelliteAlt}
                    sx={{ fontSize: "0.875rem", color: "text.secondary" }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {portal.stationName}
                  </Typography>
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary">
                {DateFactory.relativeTime(portal.lastOpened ?? portal.created)}
              </Typography>
            </Stack>
          </DetailCard>
        );
      })}
    </CardList>
  );
};

// ── Data component ──────────────────────────────────────────────────

interface PortalDataProps {
  children: (data: ReturnType<typeof sdk.portals.list>) => React.ReactNode;
}

const RecentPortalData: React.FC<PortalDataProps> = ({ children }) => {
  const res = sdk.portals.list({
    limit: 5,
    offset: 0,
    sortBy: "lastOpened",
    sortOrder: "desc",
    include: "station",
  });
  return <>{children(res)}</>;
};

// ── Connected ───────────────────────────────────────────────────────

export interface RecentPortalsListConnectedProps {
  onDeletePortal: (portalId: string, portalName: string) => void;
}

export const RecentPortalsListConnected: React.FC<
  RecentPortalsListConnectedProps
> = ({ onDeletePortal }) => (
  <RecentPortalData>
    {(result) => (
      <DataResult results={{ portals: result }}>
        {(data) => {
          const payload = data.portals as unknown as PortalListResponsePayload;
          return (
            <RecentPortalsListUI
              portals={payload.portals}
              onDeletePortal={onDeletePortal}
            />
          );
        }}
      </DataResult>
    )}
  </RecentPortalData>
);
