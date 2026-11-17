import React from "react";

import type {
  OrganizationGetResponse,
  StationGetResponsePayload,
} from "@portalai/core/contracts";
import { MetadataList } from "@portalai/core/ui";
import MuiLink from "@mui/material/Link";
import { Link } from "@tanstack/react-router";

import DataResult from "./DataResult.component";
import { OrgData } from "./StationList.component";
import { sdk } from "../api/sdk";
import { isStationUnavailable } from "../utils/portal-station.util";

// ── The default station's line ─────────────────────────────────────

interface DefaultStationLineProps {
  stationId: string;
}

const DefaultStationLine: React.FC<DefaultStationLineProps> = ({
  stationId,
}) => {
  const result = sdk.stations.get(stationId);

  // #1041: the org's id can outlive the station for this viewer. It was
  // deleted in another tab or by another member (the delete refreshes the
  // org only in the session that ran it), or it isn't shared with them: an
  // unreadable station answers 404 like a missing one. Either way they have
  // no default station to show, which is not an error.
  if (isStationUnavailable(result.error)) return null;

  return (
    <MetadataList
      items={[
        {
          label: "Default Station",
          value: (
            <DataResult results={{ station: result }}>
              {(data) => {
                const payload =
                  data.station as unknown as StationGetResponsePayload;
                return (
                  <MuiLink
                    component={Link}
                    to={`/stations/${payload.station.id}`}
                    variant="body2"
                  >
                    {payload.station.name}
                  </MuiLink>
                );
              }}
            </DataResult>
          ),
        },
      ]}
    />
  );
};

// ── Default station metadata ───────────────────────────────────────

export const DefaultStationMeta: React.FC = () => (
  <OrgData>
    {(orgResult) => (
      <DataResult results={{ org: orgResult }}>
        {(data) => {
          const org = data.org as unknown as OrganizationGetResponse;
          const defaultStationId = org.organization.defaultStationId;

          if (!defaultStationId) return null;

          return <DefaultStationLine stationId={defaultStationId} />;
        }}
      </DataResult>
    )}
  </OrgData>
);
