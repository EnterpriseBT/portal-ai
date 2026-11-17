import React from "react";

import Alert from "@mui/material/Alert";
import { describeStationAttachmentGaps } from "@portalai/core/content";

export interface StationAttachmentAlertsUIProps {
  /** How many curated views are attached to the station. */
  viewCount: number;
  /** How many connector instances are attached to the station. */
  connectorCount: number;
}

/**
 * The station-level "nothing attached" notice (#674), worded by
 * `describeStationAttachmentGaps` — the same sentences the system prompt and
 * platform_help use. One alert: a combined sentence when both kinds are
 * missing, a single one otherwise, nothing when both are attached. It is the
 * same for every viewer; attachments a viewer can't read show as locked
 * chips, not as an alert.
 *
 * It is an `info` alert, not a warning (#848): a station without views or
 * connectors is valid (the provisioned Administrate station has neither), so
 * the notice says what attaching one would add.
 */
export const StationAttachmentAlertsUI: React.FC<
  StationAttachmentAlertsUIProps
> = ({ viewCount, connectorCount }) => {
  // Readable counts don't affect `missing`, so pass the attached counts.
  const { missing } = describeStationAttachmentGaps({
    views: { attached: viewCount, readable: viewCount },
    connectors: { attached: connectorCount, readable: connectorCount },
  });
  if (!missing) return null;
  return (
    <Alert severity="info" variant="outlined">
      {missing}
    </Alert>
  );
};
