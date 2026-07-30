import React from "react";

import type { Station } from "@portalai/core/models";
import type {
  OrganizationGetResponse,
  StationGetResponsePayload,
} from "@portalai/core/contracts";
import {
  Button,
  DetailCard,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  Stack,
  Typography,
} from "@portalai/core/ui";
import Link from "@mui/material/Link";

import DataResult from "./DataResult.component";
import { OrgData } from "./StationList.component";
import { ToolPackChip } from "./ToolPackChip.component";
import {
  ALL_BUILTIN_SLUGS,
  isBuiltinPackEntitled,
} from "../utils/tool-packs.util";
import { useBuiltinEntitlements } from "../utils/use-builtin-entitlements.util";
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
  station: (Station & { enabledToolpacks?: string[] }) | null;
  onLaunchPortal: (stationId: string) => void;
  onChangeDefault: () => void;
  onViewStation?: (stationId: string) => void;
  /**
   * Built-in pack slugs the org's tier includes (#284). Chips for packs
   * outside the set render inert with the reason named. Defaults to every
   * built-in (fail open).
   */
  entitledBuiltinSlugs?: ReadonlySet<string>;
}

export const DefaultStationCardUI: React.FC<DefaultStationCardUIProps> = ({
  station,
  onLaunchPortal,
  onChangeDefault,
  onViewStation,
  entitledBuiltinSlugs = ALL_BUILTIN_SLUGS,
}) => {
  if (!station) {
    return (
      <PageEmptyState
        data-testid="default-station-card"
        icon={<Icon name={IconName.SatelliteAlt} />}
        title="No default station"
        description="Go to Stations to set one."
        action={
          <Button variant="contained" size="small" onClick={onChangeDefault}>
            Go to Stations
          </Button>
        }
      />
    );
  }

  return (
    <DetailCard
      title={station.name}
      data-testid="default-station-card"
      onClick={onViewStation ? () => onViewStation(station.id) : undefined}
      actions={[
        {
          label: "Open Portal",
          icon: <Icon name={IconName.Portal} />,
          variant: "contained",
          onClick: () => onLaunchPortal(station.id),
        },
      ]}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.5} alignItems="baseline">
          <Typography variant="caption" color="text.secondary">
            Default Station
          </Typography>
          <Link
            component="span"
            variant="caption"
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChangeDefault();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onChangeDefault();
              }
            }}
            sx={{ cursor: "pointer" }}
          >
            (change)
          </Link>
        </Stack>
        <MetadataList
          items={[
            {
              label: "Description",
              value: station.description ?? "",
              hidden: !station.description,
            },
            {
              label: "Tool Packs",
              value: (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {(station.enabledToolpacks ?? []).map((pack) => (
                    <ToolPackChip
                      key={pack}
                      pack={pack}
                      entitled={isBuiltinPackEntitled(
                        pack,
                        entitledBuiltinSlugs
                      )}
                    />
                  ))}
                </Stack>
              ),
              variant: "chip",
              hidden: (station.enabledToolpacks ?? []).length === 0,
            },
          ]}
        />
      </Stack>
    </DetailCard>
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
> = ({ onLaunchPortal, onChangeDefault, onViewStation }) => {
  // #284: entitlements for the attached-pack chips below.
  const { entitledSlugs: entitledBuiltinSlugs } = useBuiltinEntitlements();
  return (
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
                          entitledBuiltinSlugs={entitledBuiltinSlugs}
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
};
