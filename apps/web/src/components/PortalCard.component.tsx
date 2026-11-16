import React from "react";

import { DetailCard, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import type { ActionSuiteItem } from "@portalai/core/ui";
import DeleteIcon from "@mui/icons-material/Delete";

import { decideActionGate } from "../utils/action-gate.util";
import { RouterLink } from "./RouterLink.component";

interface PortalCardUIProps {
  id: string;
  name: string;
  created: number;
  lastOpened: number | null;
  /** #690: the portal's `capabilities.delete`. */
  canDelete: boolean;
  onDelete: (id: string) => void;
}

export const PortalCardUI: React.FC<PortalCardUIProps> = ({
  id,
  name,
  created,
  lastOpened,
  canDelete,
  onDelete,
}) => {
  const actions: ActionSuiteItem[] = [
    {
      label: "Delete",
      icon: <DeleteIcon />,
      onClick: () => onDelete(id),
      color: "error",
      gate: decideActionGate({ allowed: canDelete }),
    },
  ];

  return (
    <DetailCard
      title={name}
      // #794: the card opens its portal through its title's link.
      href={`/portals/${id}`}
      linkComponent={RouterLink}
      actions={actions}
      data-testid={`portal-card-${id}`}
    >
      <Typography variant="caption" color="text.secondary">
        {lastOpened
          ? `Opened ${DateFactory.relativeTime(lastOpened)}`
          : `Created ${DateFactory.relativeTime(created)}`}
      </Typography>
    </DetailCard>
  );
};
