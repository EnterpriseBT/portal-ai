import React from "react";

import type { ObjectCapabilities } from "@portalai/core/contracts";
import type { EntityTag } from "@portalai/core/models";
import { Box, DetailCard, Typography } from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import { decideActionGate } from "../utils/action-gate.util";

export interface TagCardUIProps {
  /** A list row, with the caller's `capabilities` on it (#689). */
  tag: EntityTag & { capabilities: ObjectCapabilities };
  onEdit: (tag: EntityTag) => void;
  onDelete: (tag: EntityTag) => void;
}

export const TagCardUI: React.FC<TagCardUIProps> = ({
  tag,
  onEdit,
  onDelete,
}) => {
  const actions: ActionSuiteItem[] = [
    {
      label: "Edit",
      icon: <EditIcon />,
      onClick: () => onEdit(tag),
      gate: decideActionGate({ allowed: tag.capabilities.write }),
    },
    {
      label: "Delete",
      icon: <DeleteIcon />,
      onClick: () => onDelete(tag),
      color: "error",
      gate: decideActionGate({ allowed: tag.capabilities.delete }),
    },
  ];

  return (
    <DetailCard
      title={tag.name}
      icon={
        tag.color ? (
          <Box
            data-testid="tag-color-dot"
            sx={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              backgroundColor: tag.color,
              flexShrink: 0,
            }}
          />
        ) : undefined
      }
      actions={actions}
    >
      {tag.description && (
        <Typography variant="body2" color="text.secondary" noWrap>
          {tag.description}
        </Typography>
      )}
    </DetailCard>
  );
};
