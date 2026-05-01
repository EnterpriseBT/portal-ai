import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import SyncIcon from "@mui/icons-material/Sync";

import { JobModel } from "@portalai/core/models";
import type { JobStatus } from "@portalai/core/models";

const SYNC_INELIGIBLE_TOOLTIP =
  "Sync is unavailable for this connector. Commit a layout plan first.";
const ROW_POSITION_ADVISORY_TOOLTIP =
  "Re-sync recreates all records in the affected region(s).";

export interface ConnectorInstanceSyncButtonUIProps {
  /** Whether the persisted plan / connector type is sync-eligible. */
  syncEligible: boolean;
  /**
   * Non-blocking advisories from `assertSyncEligibility`. When non-empty,
   * the Sync button stays enabled but surfaces a tooltip explaining that
   * the upcoming sync will reap and recreate records in the named region(s)
   * — typically because those regions use `rowPosition` identity. The UI
   * is only told *that* the warning applies; it doesn't render the region
   * ids themselves (the review-step banner is the place for that detail).
   */
  identityWarnings?: { regionId: string }[];
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
 * Renders just the button (with disabled-while-pending state and a
 * tooltip in two cases: (a) the connector is not sync-eligible — the
 * button is disabled and the tooltip explains why; (b) sync is eligible
 * but `identityWarnings` is non-empty — the button is enabled and the
 * tooltip explains the reap-and-recreate consequence).
 *
 * Progress + result feedback render separately via
 * `ConnectorInstanceSyncFeedbackUI` so trigger and feedback can occupy
 * different layout slots — typically trigger as the page's primary action
 * and feedback below the header.
 *
 * State is owned upstream via `useConnectorInstanceSync`.
 */
export const ConnectorInstanceSyncButtonUI = ({
  syncEligible,
  identityWarnings,
  isStarting,
  jobStatus,
  onSync,
  variant = "outlined",
}: ConnectorInstanceSyncButtonUIProps) => {
  const isLive = jobStatus !== null && !JobModel.isTerminalStatus(jobStatus);
  const isPending = isStarting || isLive;
  const hasIdentityWarnings = (identityWarnings?.length ?? 0) > 0;

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

  if (!syncEligible) {
    return <Tooltip title={SYNC_INELIGIBLE_TOOLTIP}>{button}</Tooltip>;
  }
  if (hasIdentityWarnings) {
    return (
      <Tooltip title={ROW_POSITION_ADVISORY_TOOLTIP}>{button}</Tooltip>
    );
  }
  return button;
};
