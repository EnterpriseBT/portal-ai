import React from "react";

import {
  DetailCard,
  Icon,
  IconName,
  StatusMessage,
  type ActionSuiteItem,
} from "@portalai/core/ui";

import { RouterLink } from "./RouterLink.component";

/** Whether a tile's content has loaded. */
export type PinTileStatus = "loading" | "error" | "ready";

export interface PinTileUIProps {
  pin: { id: string; title: string };
  status: PinTileStatus;
  /** Offered as Retry while the tile shows its error. */
  onRetry?: (pinId: string) => void;
  /** The pinned block, shown once `status` is "ready". */
  children?: React.ReactNode;
}

/**
 * One favorite pin on the dashboard (#1123). The tile owns its frame only:
 * a title linking to the pinned result, and its loading and error states.
 * The block itself comes in as `children`, since rendering it needs the SDK.
 */
export const PinTileUI: React.FC<PinTileUIProps> = ({
  pin,
  status,
  onRetry,
  children,
}) => {
  const actions: ActionSuiteItem[] =
    status === "error" && onRetry
      ? [
          {
            label: "Retry",
            icon: <Icon name={IconName.Refresh} />,
            onClick: () => onRetry(pin.id),
          },
        ]
      : [];

  return (
    <DetailCard
      title={pin.title}
      href={`/portal-results/${pin.id}`}
      linkComponent={RouterLink}
      headingLevel={3}
      actions={actions}
      data-testid={`pin-tile-${pin.id}`}
    >
      {status === "loading" && (
        <StatusMessage loading message={`Loading ${pin.title}…`} />
      )}
      {status === "error" && (
        <StatusMessage variant="error" message="Couldn't load this result." />
      )}
      {status === "ready" && children}
    </DetailCard>
  );
};
