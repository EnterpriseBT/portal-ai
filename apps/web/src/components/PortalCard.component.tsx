import React from "react";

import { DetailCard, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import type { ActionSuiteItem } from "@portalai/core/ui";
import DeleteIcon from "@mui/icons-material/Delete";

interface PortalCardUIProps {
  id: string;
  name: string;
  created: number;
  lastOpened: number | null;
  onClick: (id: string) => void;
  onDelete: (id: string) => void;
}

export const PortalCardUI: React.FC<PortalCardUIProps> = ({
  id,
  name,
  created,
  lastOpened,
  onClick,
  onDelete,
}) => {
  const actions: ActionSuiteItem[] = [
    { label: "Delete", icon: <DeleteIcon />, onClick: () => onDelete(id), color: "error" },
  ];

  return (
    <DetailCard
      title={name}
      onClick={() => onClick(id)}
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
