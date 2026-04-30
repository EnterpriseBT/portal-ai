import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import SyncIcon from "@mui/icons-material/Sync";

import { JobModel } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";

const SYNC_INELIGIBLE_TOOLTIP =
  "This connector uses positional row IDs and can't be re-synced. Re-edit the regions to add an identifier column.";

export interface ConnectorInstanceSyncButtonUIProps {
  /** Whether the persisted plan / connector type is sync-eligible. */
  syncEligible: boolean;
  /** Mutation in flight (HTTP POST to /sync hasn't returned yet). */
  isStarting: boolean;
  /** Live job status from the SSE stream, or `null` when no job is active. */
  jobStatus: JobStatus | null;
  /** Click handler — fires the mutation. */
  onSync: () => void;
  /**
   * Visual variant. `"contained"` is the high-emphasis style used when
   * Sync is the page's primary action; `"outlined"` is the lower-emphasis
   * style used inline elsewhere (when sync is configured but the primary
   * action is something else like Edit).
   */
  variant?: "contained" | "outlined";
}

/**
 * Pure UI trigger for the connector-instance "Sync now" affordance.
 *
 * Renders just the button (with disabled-while-pending state and the
 * "not eligible" tooltip). Progress + result feedback render separately
 * via `ConnectorInstanceSyncFeedbackUI` so trigger and feedback can
 * occupy different layout slots — typically trigger as the page's
 * primary action and feedback below the header.
 *
 * State is owned upstream via `useConnectorInstanceSync`.
 */
export const ConnectorInstanceSyncButtonUI = ({
  syncEligible,
  isStarting,
  jobStatus,
  onSync,
  variant = "outlined",
}: ConnectorInstanceSyncButtonUIProps) => {
  const isLive = jobStatus !== null && !JobModel.isTerminalStatus(jobStatus);
  const isPending = isStarting || isLive;

  const button = (
    <span>
      <Button
        variant={variant}
        startIcon={<SyncIcon />}
        onClick={onSync}
        disabled={!syncEligible || isPending}
      >
        {isPending ? "Syncing…" : "Sync now"}
      </Button>
    </span>
  );

  if (syncEligible) return button;
  return <Tooltip title={SYNC_INELIGIBLE_TOOLTIP}>{button}</Tooltip>;
};
