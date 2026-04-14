import React from "react";

import type { PortalListResponsePayload, PortalWithIncludes } from "@portalai/core/contracts";
import { DetailCard, Stack, Typography } from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import DeleteIcon from "@mui/icons-material/Delete";

import DataResult from "./DataResult.component";
import { sdk } from "../api/sdk";

// ── Pure UI ─────────────────────────────────────────────────────────

export interface RecentPortalsListUIProps {
  portals: PortalWithIncludes[];
  onPortalClick: (portalId: string) => void;
  onDeletePortal: (portalId: string, portalName: string) => void;
}

export const RecentPortalsListUI: React.FC<RecentPortalsListUIProps> = ({
  portals,
  onPortalClick,
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
        No portals yet
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {portals.map((portal) => {
        const actions: ActionSuiteItem[] = [
          {
            label: "Delete",
            icon: <DeleteIcon />,
            color: "error",
            onClick: () => onDeletePortal(portal.id, portal.name),
          },
        ];

        return (
          <DetailCard
            key={portal.id}
            title={portal.name}
            onClick={() => onPortalClick(portal.id)}
            actions={actions}
            data-testid={`portal-row-${portal.id}`}
          >
            <Stack spacing={0.25}>
              {portal.stationName && (
                <Typography variant="caption" color="text.secondary">
                  {portal.stationName}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {DateFactory.relativeTime(portal.lastOpened ?? portal.created)}
              </Typography>
            </Stack>
          </DetailCard>
        );
      })}
    </Stack>
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
  onPortalClick: (portalId: string) => void;
  onDeletePortal: (portalId: string, portalName: string) => void;
}

export const RecentPortalsListConnected: React.FC<
  RecentPortalsListConnectedProps
> = ({ onPortalClick, onDeletePortal }) => (
  <RecentPortalData>
    {(result) => (
      <DataResult results={{ portals: result }}>
        {(data) => {
          const payload =
            data.portals as unknown as PortalListResponsePayload;
          return (
            <RecentPortalsListUI
              portals={payload.portals}
              onPortalClick={onPortalClick}
              onDeletePortal={onDeletePortal}
            />
          );
        }}
      </DataResult>
    )}
  </RecentPortalData>
);
