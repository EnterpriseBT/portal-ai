import React from "react";

import type { ObjectCapabilities, TagUsage } from "@portalai/core/contracts";
import { isSessionGenerated, type EntityTag } from "@portalai/core/models";
import { DetailCard, Typography } from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import { decideActionGate } from "../utils/action-gate.util";
import { formatTagUsage } from "../utils/tag-usage.util";
import { SessionGeneratedChipUI } from "./SessionGeneratedChip.component";
import { TagColorDotUI } from "./TagColorDot.component";

export interface TagCardUIProps {
  /** A list row, with the caller's `capabilities` on it (#689). */
  tag: EntityTag & { capabilities: ObjectCapabilities; usage?: TagUsage };
  onEdit: (tag: EntityTag) => void;
  onDelete: (tag: EntityTag) => void;
  /** The title's heading level (#794): 2 directly under a page's h1. Default 3. */
  headingLevel?: 2 | 3;
}

export const TagCardUI: React.FC<TagCardUIProps> = ({
  tag,
  onEdit,
  onDelete,
  headingLevel,
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
      headingLevel={headingLevel}
      icon={
        tag.color ? <TagColorDotUI color={tag.color} size={16} /> : undefined
      }
      actions={actions}
    >
      {tag.description && (
        <Typography variant="body2" color="text.secondary" noWrap>
          {tag.description}
        </Typography>
      )}
      {/* #1071: provenance only; the tag is still its creator's. */}
      {isSessionGenerated(tag) && <SessionGeneratedChipUI />}
      {/* #1070: where the tag is used, over what the caller can read. */}
      {tag.usage && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="tag-usage"
        >
          {formatTagUsage(tag.usage)}
        </Typography>
      )}
    </DetailCard>
  );
};
