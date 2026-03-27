import React from "react";

import type { Station } from "@portalai/core/models";
import type {
  StationListRequestQuery,
  StationListResponsePayload,
} from "@portalai/core/contracts";
import type { OrganizationGetResponse } from "@portalai/core/contracts";
import { Box, Stack, Typography } from "@portalai/core/ui";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import StarIcon from "@mui/icons-material/Star";
import DeleteIcon from "@mui/icons-material/Delete";

import DataResult from "./DataResult.component";
import { SyncTotal } from "./SyncTotal.component";
import { sdk } from "../api/sdk";

// ── Data list component ─────────────────────────────────────────────

interface StationDataListProps {
  query: StationListRequestQuery;
  children: (data: ReturnType<typeof sdk.stations.list>) => React.ReactNode;
}

export const StationDataList: React.FC<StationDataListProps> = ({
  query,
  children,
}) => {
  const res = sdk.stations.list(query);
  return <>{children(res)}</>;
};

// ── Organization data component ─────────────────────────────────────

interface OrgDataProps {
  children: (data: ReturnType<typeof sdk.organizations.current>) => React.ReactNode;
}

export const OrgData: React.FC<OrgDataProps> = ({ children }) => {
  const res = sdk.organizations.current();
  return <>{children(res)}</>;
};

// ── Station card (pure UI) ──────────────────────────────────────────

export interface StationCardUIProps {
  station: Station;
  isDefault: boolean;
  onSetDefault: (station: Station) => void;
  onOpen: (station: Station) => void;
  onDelete: (station: Station) => void;
}

export const StationCardUI: React.FC<StationCardUIProps> = ({
  station,
  isDefault,
  onSetDefault,
  onOpen,
  onDelete,
}) => (
  <Card variant="outlined">
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "flex-start", sm: "center" }}
    >
      <CardActionArea
        onClick={() => onOpen(station)}
        data-testid="station-card"
        sx={{ flex: 1, minWidth: 0 }}
      >
        <CardContent sx={{ "&:last-child": { pb: 2 } }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle1" noWrap>
              {station.name}
            </Typography>
            {isDefault && (
              <Chip
                label="Default"
                size="small"
                color="primary"
                icon={<StarIcon />}
                data-testid="default-badge"
              />
            )}
          </Stack>
          {station.description && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {station.description}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Tool packs: {station.toolPacks.join(", ")}
          </Typography>
        </CardContent>
      </CardActionArea>

      <Box sx={{ flexShrink: 0, pr: 2, py: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {!isDefault && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => onSetDefault(station)}
              aria-label="Set as default"
            >
              Set as default
            </Button>
          )}
          <IconButton
            size="small"
            color="error"
            onClick={() => onDelete(station)}
            aria-label="Delete station"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
    </Stack>
  </Card>
);

// ── Station list (pure UI) ──────────────────────────────────────────

export interface StationListUIProps {
  stations: Station[];
  defaultStationId: string | null;
  onSetDefault: (station: Station) => void;
  onOpen: (station: Station) => void;
  onDelete: (station: Station) => void;
}

export const StationListUI: React.FC<StationListUIProps> = ({
  stations,
  defaultStationId,
  onSetDefault,
  onOpen,
  onDelete,
}) => {
  if (stations.length === 0) {
    return (
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{ py: 4, textAlign: "center" }}
      >
        No stations found
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {stations.map((station) => (
        <StationCardUI
          key={station.id}
          station={station}
          isDefault={station.id === defaultStationId}
          onSetDefault={onSetDefault}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </Stack>
  );
};

// ── Connected station list ──────────────────────────────────────────

export interface StationListConnectedProps {
  query: StationListRequestQuery;
  setTotal: (t: number) => void;
  onSetDefault: (station: Station) => void;
  onOpen: (station: Station) => void;
  onDelete: (station: Station) => void;
}

export const StationListConnected: React.FC<StationListConnectedProps> = ({
  query,
  setTotal,
  onSetDefault,
  onOpen,
  onDelete,
}) => (
  <OrgData>
    {(orgResult) => (
      <StationDataList query={query}>
        {(listResult) => (
          <SyncTotal total={listResult.data?.total} setTotal={setTotal}>
            <DataResult results={{ list: listResult, org: orgResult }}>
              {(data) => {
                const list =
                  data.list as unknown as StationListResponsePayload;
                const org =
                  data.org as unknown as OrganizationGetResponse;
                return (
                  <StationListUI
                    stations={list.stations}
                    defaultStationId={org.organization.defaultStationId}
                    onSetDefault={onSetDefault}
                    onOpen={onOpen}
                    onDelete={onDelete}
                  />
                );
              }}
            </DataResult>
          </SyncTotal>
        )}
      </StationDataList>
    )}
  </OrgData>
);
