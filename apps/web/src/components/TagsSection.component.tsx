import React from "react";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import type { TagTarget } from "@portalai/core/models";
import { Box, Icon, IconName, PageSection } from "@portalai/core/ui";
import type { ActionGate, SelectOption } from "@portalai/core/ui";

import { decideActionGate } from "../utils/action-gate.util";
import { useTagAssignments } from "../utils/use-tag-assignments.util";
import { TagAssignSelectUI } from "./TagAssignSelect.component";
import { TagChipListUI } from "./TagChipList.component";

export interface TagsSectionUIProps {
  /** The object's tags; undefined while they load. */
  tags: AssignedEntityTag[] | undefined;
  /** Editing: `allow` shows the picker and removable chips. Anything else
   *  is read-only, since tagging needs write on the object (#1070). */
  gate: ActionGate;
  onAssign: (entityTagId: string) => void;
  onUnassign: (assignmentId: string) => void;
  onSearch: (query: string) => Promise<SelectOption[]>;
  /** #630: false when the caller can't read tags. Defaults true. */
  canReadTags?: boolean;
}

/**
 * A detail page's Tags section (#1070). A caller who can edit sees the
 * picker even with no tags yet; a read-only caller sees the chips, and
 * nothing at all when there are none.
 */
export const TagsSectionUI: React.FC<TagsSectionUIProps> = ({
  tags,
  gate,
  onAssign,
  onUnassign,
  onSearch,
  canReadTags = true,
}) => {
  if (!tags) return null;
  const editable = gate.kind === "allow";
  if (!editable && tags.length === 0) return null;

  return (
    <PageSection title="Tags" icon={<Icon name={IconName.Label} />}>
      <TagChipListUI
        tags={tags}
        onDelete={editable ? (tag) => onUnassign(tag.assignmentId) : undefined}
      />
      {editable && (
        <Box sx={{ mt: 1, maxWidth: 300 }}>
          <TagAssignSelectUI
            onSearch={onSearch}
            onAssign={onAssign}
            canRead={canReadTags}
          />
        </Box>
      )}
    </PageSection>
  );
};

export interface TagsSectionProps {
  target: TagTarget;
  /** The caller's write capability on the object. */
  canWrite: boolean;
}

/** {@link TagsSectionUI} wired to the object's tags. */
export const TagsSection: React.FC<TagsSectionProps> = ({
  target,
  canWrite,
}) => {
  const handle = useTagAssignments(target);
  return (
    <TagsSectionUI
      tags={handle.tags}
      gate={decideActionGate({ allowed: canWrite })}
      onAssign={handle.onAssign}
      onUnassign={handle.onUnassign}
      onSearch={handle.onSearch}
      canReadTags={handle.canReadTags}
    />
  );
};
