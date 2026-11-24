import React from "react";

import type { Station } from "@portalai/core/models";
import type {
  StationListRequestQuery,
  StationListResponsePayload,
} from "@portalai/core/contracts";
import type { OrganizationGetResponse } from "@portalai/core/contracts";
import {
  CardList,
  DetailCard,
  Icon,
  IconName,
  MetadataList,
  EmptyState,
  Stack,
} from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import { EmptyResults } from "./EmptyResults.component";
import { FavoriteToggle } from "./FavoriteToggle.component";
import { FavoritesEmptyResults } from "./FavoritesEmptyResults.component";
import { emptyListHelp } from "../utils/empty-list-help.util";
import { RouterLink } from "./RouterLink.component";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";

import DataResult from "./DataResult.component";
import { SyncTotal } from "./SyncTotal.component";
import { ToolPackChip } from "./ToolPackChip.component";
import {
  ALL_BUILTIN_SLUGS,
  ToolPackUtil,
  isPackEntitled,
  stationToolpackLabels,
} from "../utils/tool-packs.util";
import { decideActionGate } from "../utils/action-gate.util";
import { useBuiltinEntitlements } from "../utils/use-builtin-entitlements.util";
import { sdk } from "../api/sdk";
import { TagChipListUI } from "./TagChipList.component";

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
  children: (
    data: ReturnType<typeof sdk.organizations.current>
  ) => React.ReactNode;
}

export const OrgData: React.FC<OrgDataProps> = ({ children }) => {
  const res = sdk.organizations.current();
  return <>{children(res)}</>;
};

// ── Station card (pure UI) ──────────────────────────────────────────

/** A station list row: the station plus the caller's capabilities on it. */
export type StationRow = StationListResponsePayload["stations"][number];

export interface StationCardUIProps {
  station: StationRow;
  /** #1072: a control beside the name (the favorite star). */
  titleAction?: React.ReactNode;
  isDefault: boolean;
  /** #690: the caller may change the org's default station
   *  (`station.default.set`, owner/admin). */
  canSetDefault: boolean;
  onSetDefault: (station: Station) => void;
  onDelete: (station: Station) => void;
  /**
   * Built-in pack slugs the org's tier includes (#284). Chips for packs
   * outside the set render inert with the reason named — the pack stays
   * visible, since a downgrade legitimately leaves it attached. Defaults to
   * every built-in (fail open).
   */
  entitledBuiltinSlugs?: ReadonlySet<string>;
  /**
   * #1063: the plan includes custom (organization) tool packs. Without them
   * a custom pack's chip renders inert, like an unentitled built-in.
   * Defaults to `true` (fail open).
   */
  customPacksEntitled?: boolean;
}

export const StationCardUI: React.FC<StationCardUIProps> = ({
  station,
  titleAction,
  isDefault,
  canSetDefault,
  onSetDefault,
  onDelete,
  entitledBuiltinSlugs = ALL_BUILTIN_SLUGS,
  customPacksEntitled = true,
}) => {
  // #690: what this caller may do to this station.
  // #1063: the station read names its packs; one map per station.
  const packLabels = stationToolpackLabels(station.toolpacks);
  const actions: ActionSuiteItem[] = [
    ...(!isDefault
      ? [
          {
            label: "Set as default",
            icon: <StarOutlineIcon />,
            onClick: () => onSetDefault(station),
            gate: decideActionGate({ allowed: canSetDefault }),
          },
        ]
      : []),
    {
      label: "Delete",
      icon: <DeleteIcon />,
      onClick: () => onDelete(station),
      color: "error" as const,
      gate: decideActionGate({ allowed: station.capabilities.delete }),
    },
  ];

  return (
    <DetailCard
      title={station.name}
      // #794: the card opens its station through its title's link.
      href={`/stations/${station.id}`}
      linkComponent={RouterLink}
      headingLevel={2}
      actions={actions}
      titleAction={titleAction}
      data-testid="station-card"
    >
      <MetadataList
        items={[
          {
            label: "Status",
            value: (
              <Chip
                label="Default"
                size="small"
                color="primary"
                icon={<StarIcon />}
                data-testid="default-badge"
              />
            ),
            variant: "chip",
            hidden: !isDefault,
          },
          {
            label: "Description",
            value: station.description ?? "",
            hidden: !station.description,
          },
          {
            label: "Tool packs",
            value: (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {(station.enabledToolpacks ?? []).map((pack) => (
                  <ToolPackChip
                    key={pack}
                    pack={pack}
                    label={ToolPackUtil.getLabel(pack, packLabels)}
                    entitled={isPackEntitled(
                      pack,
                      entitledBuiltinSlugs,
                      customPacksEntitled
                    )}
                  />
                ))}
              </Stack>
            ),
            variant: "chip",
            hidden: (station.enabledToolpacks ?? []).length === 0,
          },
          {
            label: "Tags",
            value: <TagChipListUI tags={station.tags} />,
            variant: "chip",
            hidden: !station.tags?.length,
          },
        ]}
      />
    </DetailCard>
  );
};

// ── Station list (pure UI) ──────────────────────────────────────────

export interface StationListUIProps {
  stations: StationRow[];
  /** #1072: the control beside each station's name (its favorite star). */
  renderTitleAction?: (station: StationRow) => React.ReactNode;
  /**
   * #1072: the Favorites toggle is the one active filter, so an empty list means
   * nothing is starred and says how to star a station.
   */
  favoritesOnly?: boolean;
  defaultStationId: string | null;
  /** #690: see {@link StationCardUIProps.canSetDefault}. */
  canSetDefault: boolean;
  onSetDefault: (station: Station) => void;
  onDelete: (station: Station) => void;
  /** When true, shows a "no results" message instead of the full empty state. */
  hasActiveFilters?: boolean;
  /**
   * Built-in pack slugs the org's tier includes (#284). Chips for packs
   * outside the set render inert with the reason named — the pack stays
   * visible, since a downgrade legitimately leaves it attached. Defaults to
   * every built-in (fail open).
   */
  entitledBuiltinSlugs?: ReadonlySet<string>;
  /**
   * #1063: the plan includes custom (organization) tool packs. Without them
   * a custom pack's chip renders inert, like an unentitled built-in.
   * Defaults to `true` (fail open).
   */
  customPacksEntitled?: boolean;
}

export const StationListUI: React.FC<StationListUIProps> = ({
  stations,
  renderTitleAction,
  favoritesOnly,
  defaultStationId,
  canSetDefault,
  onSetDefault,
  onDelete,
  hasActiveFilters,
  entitledBuiltinSlugs,
  customPacksEntitled,
}) => {
  if (stations.length === 0) {
    if (favoritesOnly) return <FavoritesEmptyResults noun="station" />;
    return hasActiveFilters ? (
      <EmptyResults />
    ) : (
      <EmptyState
        icon={<Icon name={IconName.SatelliteAlt} />}
        title="No stations found"
        {...emptyListHelp("stations")}
      />
    );
  }

  return (
    <CardList aria-label="Stations">
      {stations.map((station) => (
        <StationCardUI
          key={station.id}
          station={station}
          titleAction={renderTitleAction?.(station)}
          isDefault={station.id === defaultStationId}
          canSetDefault={canSetDefault}
          onSetDefault={onSetDefault}
          onDelete={onDelete}
          entitledBuiltinSlugs={entitledBuiltinSlugs}
          customPacksEntitled={customPacksEntitled}
        />
      ))}
    </CardList>
  );
};

// ── Connected station list ──────────────────────────────────────────

export interface StationListConnectedProps {
  query: StationListRequestQuery;
  setTotal: (t: number) => void;
  onSetDefault: (station: Station) => void;
  hasActiveFilters?: boolean;
  /** #1072: see {@link StationListUIProps.favoritesOnly}. */
  favoritesOnly?: boolean;
  onDelete: (station: Station) => void;
}

export const StationListConnected: React.FC<StationListConnectedProps> = ({
  query,
  setTotal,
  onSetDefault,
  onDelete,
  hasActiveFilters,
  favoritesOnly,
}) => {
  // #284: one shared usage-query read for every card's chips.
  const { entitledSlugs: entitledBuiltinSlugs, customPacksEntitled } =
    useBuiltinEntitlements();
  return (
    <OrgData>
      {(orgResult) => (
        <StationDataList query={query}>
          {(listResult) => (
            <SyncTotal total={listResult.data?.total} setTotal={setTotal}>
              <DataResult results={{ list: listResult, org: orgResult }}>
                {(data) => {
                  const list =
                    data.list as unknown as StationListResponsePayload;
                  const org = data.org as unknown as OrganizationGetResponse;
                  return (
                    <StationListUI
                      stations={list.stations}
                      defaultStationId={org.organization.defaultStationId}
                      // #690: fails closed while unknown.
                      canSetDefault={
                        org.capabilities?.["station.default.set"] ?? false
                      }
                      onSetDefault={onSetDefault}
                      onDelete={onDelete}
                      hasActiveFilters={hasActiveFilters}
                      favoritesOnly={favoritesOnly}
                      renderTitleAction={(station) => (
                        <FavoriteToggle
                          target={{ type: "station", id: station.id }}
                          name={station.name}
                          isFavorite={station.isFavorite ?? false}
                        />
                      )}
                      entitledBuiltinSlugs={entitledBuiltinSlugs}
                      customPacksEntitled={customPacksEntitled}
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
};
