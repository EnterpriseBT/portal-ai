import React from "react";

import type { Station } from "@portalai/core/models";
import type {
  StationListRequestQuery,
  StationListResponsePayload,
} from "@portalai/core/contracts";
import type { OrganizationGetResponse } from "@portalai/core/contracts";
import { Box, DetailCard, Icon, IconName, PageEmptyState, Stack, Typography } from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import { EmptyResults } from "./EmptyResults.component";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";

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
}) => {
  const actions: ActionSuiteItem[] = [
    ...(!isDefault
      ? [{ label: "Set as default", icon: <StarOutlineIcon />, onClick: () => onSetDefault(station) }]
      : []),
    { label: "Delete", icon: <DeleteIcon />, onClick: () => onDelete(station), color: "error" as const },
  ];

  return (
    <DetailCard
      title={station.name}
      onClick={() => onOpen(station)}
      actions={actions}
      data-testid="station-card"
    >
      <Stack spacing={1}>
        {isDefault && (
          <Box>
            <Chip
              label="Default"
              size="small"
              color="primary"
              icon={<StarIcon />}
              data-testid="default-badge"
            />
          </Box>
        )}
        {station.description && (
          <Typography variant="body2" color="text.secondary" noWrap>
            {station.description}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          Tool packs: {station.toolPacks.join(", ")}
        </Typography>
      </Stack>
    </DetailCard>
  );
};

// ── Station list (pure UI) ──────────────────────────────────────────

export interface StationListUIProps {
  stations: Station[];
  defaultStationId: string | null;
  onSetDefault: (station: Station) => void;
  onOpen: (station: Station) => void;
  onDelete: (station: Station) => void;
  /** When true, shows a "no results" message instead of the full empty state. */
  hasActiveFilters?: boolean;
}

export const StationListUI: React.FC<StationListUIProps> = ({
  stations,
  defaultStationId,
  onSetDefault,
  onOpen,
  onDelete,
  hasActiveFilters,
}) => {
  if (stations.length === 0) {
    return hasActiveFilters ? (
      <EmptyResults />
    ) : (
      <PageEmptyState
        icon={<Icon name={IconName.RocketLaunch} />}
        title="No stations found"
        description="Create your first station to get started."
      />
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
  hasActiveFilters?: boolean;
  onDelete: (station: Station) => void;
}

export const StationListConnected: React.FC<StationListConnectedProps> = ({
  query,
  setTotal,
  onSetDefault,
  onOpen,
  onDelete,
  hasActiveFilters,
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
                    hasActiveFilters={hasActiveFilters}
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
