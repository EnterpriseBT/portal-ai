import React from "react";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import { Box, Button, Modal, Stack } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { TagAssignSelectUI } from "./TagAssignSelect.component";
import { TagChipListUI } from "./TagChipList.component";

export interface TagsDialogUIProps {
  open: boolean;
  onClose: () => void;
  /** The object's name, for the title. */
  name: string;
  tags: AssignedEntityTag[];
  onAssign: (entityTagId: string) => void;
  onUnassign: (assignmentId: string) => void;
  onSearch: (query: string) => Promise<SelectOption[]>;
  /** #630: false when the caller can't read tags. Defaults true. */
  canReadTags?: boolean;
}

/**
 * Edits one object's tags (#1115). Each pick and each removed chip is saved
 * by its own call as it happens, and that call's toast and refresh run even
 * after the dialog closes (#970). So there is no submit, no form alert and
 * no pending state: Done, Escape and the close button always close it, and
 * nothing is left unsaved.
 */
export const TagsDialogUI: React.FC<TagsDialogUIProps> = ({
  open,
  onClose,
  name,
  tags,
  onAssign,
  onUnassign,
  onSearch,
  canReadTags = true,
}) => {
  const inputRef = useDialogAutoFocus<HTMLInputElement>(open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Tags for ${name}`}
      maxWidth="xs"
      fullWidth
      actions={
        <Button type="button" variant="contained" onClick={onClose}>
          Done
        </Button>
      }
    >
      <Stack spacing={2}>
        <TagChipListUI
          tags={tags}
          onDelete={(tag) => onUnassign(tag.assignmentId)}
        />
        <Box>
          <TagAssignSelectUI
            onSearch={onSearch}
            onAssign={onAssign}
            canRead={canReadTags}
            inputRef={inputRef}
          />
        </Box>
      </Stack>
    </Modal>
  );
};
