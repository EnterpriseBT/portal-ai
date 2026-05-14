import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import EditIcon from "@mui/icons-material/Edit";

const UNSUPPORTED_SLUG_TOOLTIP =
  "Layout plan editing isn't supported for this connector type.";

/**
 * Slug allow-list for layout-plan editing. Mirrors the backend's
 * `EDITABLE_SLUGS` in `connector-instance-layout-plans.service.ts` so
 * the UI affordance and the server-side `editable` flag agree on
 * which connectors can be edited at all. The "source removed" branch
 * is handled by the edit view itself (the server flips `editable:
 * false` with a `SOURCE_REMOVED` reason); this list controls only
 * whether the entry point is enabled in the first place.
 */
const EDITABLE_SLUGS = new Set([
  "file-upload",
  "google-sheets",
  "microsoft-excel",
]);

export function isEditableConnectorSlug(slug: string): boolean {
  return EDITABLE_SLUGS.has(slug);
}

export interface ConnectorInstanceEditLayoutPlanButtonUIProps {
  connectorDefinitionSlug: string;
  /**
   * When set, the button is disabled and renders this string as the
   * tooltip. Set by `ConnectorInstance.view` when an unrelated job
   * (`layout_plan_commit`, `connector_sync`) has locked the instance.
   */
  lockedReason?: string | null;
  /** Click handler — typically navigates to the layout-plan edit route. */
  onClick: () => void;
  variant?: "contained" | "outlined";
}

/**
 * Pure UI trigger for the "Edit layout plan" affordance on the
 * connector-instance detail view. Visible for every connector but
 * disabled with an explanatory tooltip when the slug isn't in the
 * edit-supported set or when a running job has locked the instance.
 *
 * Same disabled+tooltip pattern as `ConnectorInstanceSyncButtonUI` so
 * the two action buttons stay visually + behaviourally consistent.
 */
export const ConnectorInstanceEditLayoutPlanButtonUI = ({
  connectorDefinitionSlug,
  lockedReason,
  onClick,
  variant = "outlined",
}: ConnectorInstanceEditLayoutPlanButtonUIProps) => {
  const isLocked = !!lockedReason;
  const isSupported = isEditableConnectorSlug(connectorDefinitionSlug);
  const disabled = isLocked || !isSupported;

  const button = (
    <span>
      <Button
        variant={variant}
        startIcon={<EditIcon />}
        onClick={onClick}
        disabled={disabled}
      >
        Edit layout plan
      </Button>
    </span>
  );

  if (isLocked) {
    return <Tooltip title={lockedReason}>{button}</Tooltip>;
  }
  if (!isSupported) {
    return <Tooltip title={UNSUPPORTED_SLUG_TOOLTIP}>{button}</Tooltip>;
  }
  return button;
};
