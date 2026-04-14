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

// ── Station name link ──────────────────────────────────────────────

interface StationNameLinkProps {
  stationId: string;
}

const StationNameLink: React.FC<StationNameLinkProps> = ({ stationId }) => {
  const result = sdk.stations.get(stationId);

  return (
    <DataResult results={{ station: result }}>
      {(data) => {
        const payload = data.station as unknown as StationGetResponsePayload;
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

          return (
            <MetadataList
              layout="responsive"
              items={[
                {
                  label: "Default Station",
                  value: <StationNameLink stationId={defaultStationId} />,
                },
              ]}
            />
          );
        }}
      </DataResult>
    )}
  </OrgData>
);
