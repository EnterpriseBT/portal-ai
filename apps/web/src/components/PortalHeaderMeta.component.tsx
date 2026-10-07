import React, { useState } from "react";

import type {
  OrganizationUsageGetResponse,
  StationGetResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  MetadataList,
  Stack,
  Typography,
} from "@portalai/core/ui";
import Collapse from "@mui/material/Collapse";
import MuiLink from "@mui/material/Link";
import { Link } from "@tanstack/react-router";

import { StationAttachmentAlertsUI } from "./StationAttachmentAlerts.component";
import { StationAttachmentListUI } from "./StationAttachmentList.component";
import { ToolPackChipWithMetadata } from "./ToolPackChipWithMetadata.component";
import { sdk } from "../api/sdk";
import { toStationAttachmentItems } from "../utils/station-attachments.util";
import { useBuiltinEntitlements } from "../utils/use-builtin-entitlements.util";
import { useLayout } from "../utils/layout.util";
import { formatUsageValue } from "../utils/usage-format.util";
import {
  STATION_LOAD_FAILED_MESSAGE,
  STATION_UNAVAILABLE_MESSAGE,
  usePortalStation,
} from "../utils/portal-station.util";

// ── Pure UI ─────────────────────────────────────────────────────────

export interface PortalHeaderMetaUIProps {
  /** The portal's station, or null while it loads or when it's unavailable. */
  station: StationGetResponsePayload["station"] | null;
  /** #699: the station is deleted or no longer readable by the caller. */
  stationUnavailable: boolean;
  /** #699: the station failed to load for another reason (a 5xx, network). */
  stationLoadFailed?: boolean;
  usage?: OrganizationUsageGetResponse["usage"]["byClass"];
  isEntitled: (pack: string) => boolean;
  isMobile: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * The portal's session details: the org usage strip (always, since it isn't
 * station-specific), then the station, its attachments and tool packs. While
 * the station loads only usage shows; when it's unavailable a line says so.
 */
export const PortalHeaderMetaUI: React.FC<PortalHeaderMetaUIProps> = ({
  station,
  stationUnavailable,
  stationLoadFailed = false,
  usage,
  isEntitled,
  isMobile,
  expanded,
  onToggleExpanded,
}) => {
  // Usage allocation lives on its own always-visible strip, above (and
  // separate from) the collapsible session details, so account balance is
  // glanceable regardless of the mobile toggle state.
  const usageMeta = usage ? (
    <MetadataList
      size="small"
      spacing={0.75}
      items={[
        {
          label: "Metered usage",
          value: formatUsageValue(usage.metered),
          icon: <Icon name={IconName.Search} fontSize="small" />,
        },
        {
          label: "Expensive usage",
          value: formatUsageValue(usage.expensive),
          icon: <Icon name={IconName.MemoryChip} fontSize="small" />,
        },
      ]}
    />
  ) : null;

  if (!station || stationUnavailable) {
    return (
      <Stack spacing={1}>
        {usageMeta}
        {stationUnavailable ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="portal-header-station-unavailable"
          >
            {STATION_UNAVAILABLE_MESSAGE}
          </Typography>
        ) : stationLoadFailed ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="portal-header-station-load-failed"
          >
            {STATION_LOAD_FAILED_MESSAGE}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  const attachments = toStationAttachmentItems(station);
  const toolPacks = station.enabledToolpacks ?? [];

  const metadata = (
    <MetadataList
      size="small"
      spacing={0.75}
      items={[
        {
          label: "Station",
          value: (
            <MuiLink
              component={Link}
              to={`/stations/${station.id}`}
              variant="body2"
              data-testid="portal-header-station-link"
            >
              {station.name}
            </MuiLink>
          ),
        },
        // #674: both rows always show (— when empty); the alert says why.
        {
          label: "Connectors",
          value: (
            <StationAttachmentListUI
              kind="connector"
              items={attachments.connectors}
            />
          ),
          variant: "chip",
        },
        {
          label: "Views",
          value: (
            <StationAttachmentListUI kind="view" items={attachments.views} />
          ),
          variant: "chip",
        },
        {
          label: "Tool Packs",
          value: (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
              {toolPacks.map((pack) => (
                <ToolPackChipWithMetadata
                  key={pack}
                  pack={pack}
                  entitled={isEntitled(pack)}
                />
              ))}
            </Stack>
          ),
          variant: "chip",
          hidden: toolPacks.length === 0,
        },
      ]}
    />
  );

  // On small screens, tuck the session details behind a toggle so the session
  // feed gets the full viewport. The button is kept small and inline.
  const sessionDetails = !isMobile ? (
    metadata
  ) : (
    <Box>
      <Button
        size="small"
        variant="text"
        onClick={onToggleExpanded}
        startIcon={
          <Icon name={expanded ? IconName.ExpandLess : IconName.ExpandMore} />
        }
        aria-expanded={expanded}
        aria-controls="portal-header-meta-panel"
        data-testid="portal-header-meta-toggle"
        sx={{ px: 0.5, textTransform: "none" }}
      >
        {expanded ? "Hide session details" : "Show session details"}
      </Button>
      <Collapse in={expanded} unmountOnExit>
        <Box id="portal-header-meta-panel" sx={{ pt: 1 }}>
          {metadata}
        </Box>
      </Collapse>
    </Box>
  );

  return (
    <Stack spacing={1}>
      {usageMeta}
      <StationAttachmentAlertsUI
        viewCount={attachments.views.length}
        connectorCount={attachments.connectors.length}
      />
      {sessionDetails}
    </Stack>
  );
};

// ── Container ───────────────────────────────────────────────────────

export interface PortalHeaderMetaProps {
  stationId: string;
}

/**
 * Fetches the portal's station (+ both attachment kinds, #674) and the org's
 * usage balance (#172), and renders the header metadata row.
 */
export const PortalHeaderMeta: React.FC<PortalHeaderMetaProps> = ({
  stationId,
}) => {
  const { station, unavailable, loadFailed } = usePortalStation(stationId);
  // Same query the Settings page reads, so React Query dedupes it.
  const { data: usageData } = sdk.organizations.usage();
  // #284: same cached query, entitlement axis.
  const { isEntitled } = useBuiltinEntitlements();
  const { isMobile } = useLayout();
  const [expanded, setExpanded] = useState(false);

  return (
    <PortalHeaderMetaUI
      station={station}
      stationUnavailable={unavailable}
      stationLoadFailed={loadFailed}
      usage={usageData?.usage.byClass}
      isEntitled={isEntitled}
      isMobile={isMobile}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((e) => !e)}
    />
  );
};
