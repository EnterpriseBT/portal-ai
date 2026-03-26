import React from "react";

import type { Station } from "@portalai/core/models";
import type {
  OrganizationGetResponse,
  StationGetResponsePayload,
} from "@portalai/core/contracts";
import { Button, Stack, Typography } from "@portalai/core/ui";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import RocketLaunch from "@mui/icons-material/RocketLaunch";

import DataResult from "./DataResult.component";
import { OrgData } from "./StationList.component";
import { sdk } from "../api/sdk";

// ── Station data fetch ──────────────────────────────────────────────

interface StationDataProps {
  id: string;
  children: (data: ReturnType<typeof sdk.stations.get>) => React.ReactNode;
}

const StationData: React.FC<StationDataProps> = ({ id, children }) => {
  const res = sdk.stations.get(id);
  return <>{children(res)}</>;
};

// ── Pure UI ─────────────────────────────────────────────────────────

export interface DefaultStationCardUIProps {
  station: Station | null;
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onViewStation?: (stationId: string) => void;
}

export const DefaultStationCardUI: React.FC<DefaultStationCardUIProps> = ({
  station,
  onLaunchPortal,
  onChangeDefault,
  onViewStation,
}) => {
  if (!station) {
    return (
      <Card variant="outlined" data-testid="default-station-card">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Default Station
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No default station — go to Stations to set one
          </Typography>
          <Button variant="outlined" size="small" onClick={onChangeDefault}>
            Go to Stations
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined" data-testid="default-station-card">
      <CardContent>
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography variant="h6" gutterBottom>{station.name}</Typography>
          {onViewStation && (
            <Typography
              variant="caption"
              color="primary"
              onClick={() => onViewStation(station.id)}
              sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
            >
              View Station
            </Typography>
          )}
        </Stack>
        <Stack spacing={1} sx={{ mb: 2 }}>
          <Stack direction="row" spacing={0.5} alignItems="baseline">
            <Typography variant="caption" color="text.secondary">Default Station</Typography>
            <Typography
              variant="caption"
              color="primary"
              onClick={onChangeDefault}
              sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
            >
              (change)
            </Typography>
          </Stack>
          {station.description && (
            <Typography variant="body2" color="text.secondary">
              {station.description}
            </Typography>
          )}
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {station.toolPacks.map((pack) => (
              <Chip key={pack} label={pack} size="small" variant="outlined" />
            ))}
          </Stack>
        </Stack>
        <Button
          variant="contained"
          size="small"
          startIcon={<RocketLaunch />}
          onClick={() => onLaunchPortal(station.id)}
        >
          Open Portal
        </Button>
      </CardContent>
    </Card>
  );
};

// ── Connected ───────────────────────────────────────────────────────

export interface DefaultStationCardConnectedProps {
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onViewStation?: (stationId: string) => void;
}

export const DefaultStationCardConnected: React.FC<
  DefaultStationCardConnectedProps
> = ({ onLaunchPortal, onChangeDefault, onViewStation }) => (
  <OrgData>
    {(orgResult) => (
      <DataResult results={{ org: orgResult }}>
        {(data) => {
          const org = data.org as unknown as OrganizationGetResponse;
          const defaultStationId = org.organization.defaultStationId;

          if (!defaultStationId) {
            return (
              <DefaultStationCardUI
                station={null}
                onLaunchPortal={onLaunchPortal}
                onChangeDefault={onChangeDefault}
              />
            );
          }

          return (
            <StationData id={defaultStationId}>
              {(stationResult) => (
                <DataResult results={{ station: stationResult }}>
                  {(stationData) => {
                    const payload =
                      stationData.station as unknown as StationGetResponsePayload;
                    return (
                      <DefaultStationCardUI
                        station={payload.station}
                        onLaunchPortal={onLaunchPortal}
                        onChangeDefault={onChangeDefault}
                        onViewStation={onViewStation}
                      />
                    );
                  }}
                </DataResult>
              )}
            </StationData>
          );
        }}
      </DataResult>
    )}
  </OrgData>
);
