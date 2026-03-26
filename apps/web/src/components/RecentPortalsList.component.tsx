import React from "react";

import type { Portal } from "@portalai/core/models";
import type { PortalListResponsePayload } from "@portalai/core/contracts";
import { Box, Stack, Typography } from "@portalai/core/ui";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";

import DataResult from "./DataResult.component";
import { sdk } from "../api/sdk";

// ── Relative time helper ────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Pure UI ─────────────────────────────────────────────────────────

export interface RecentPortalsListUIProps {
  portals: Portal[];
  onPortalClick: (portalId: string) => void;
}

export const RecentPortalsListUI: React.FC<RecentPortalsListUIProps> = ({
  portals,
  onPortalClick,
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
      {portals.map((portal) => (
        <Card key={portal.id} variant="outlined">
          <CardActionArea
            onClick={() => onPortalClick(portal.id)}
            data-testid={`portal-row-${portal.id}`}
          >
            <CardContent sx={{ "&:last-child": { pb: 2 } }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" noWrap>
                    {portal.name}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2, flexShrink: 0 }}
                >
                  {relativeTime(portal.created)}
                </Typography>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
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
    sortBy: "created",
    sortOrder: "desc",
  });
  return <>{children(res)}</>;
};

// ── Connected ───────────────────────────────────────────────────────

export interface RecentPortalsListConnectedProps {
  onPortalClick: (portalId: string) => void;
}

export const RecentPortalsListConnected: React.FC<
  RecentPortalsListConnectedProps
> = ({ onPortalClick }) => (
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
            />
          );
        }}
      </DataResult>
    )}
  </RecentPortalData>
);
