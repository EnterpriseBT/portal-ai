import React from "react";

import type { EntityGroupMemberOverlapResponsePayload } from "@portalai/core/contracts";
import {
  AsyncSearchableSelect,
  Button,
  Modal,
  Stack,
  type SelectOption,
} from "@portalai/core/ui";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";

import { FormAlert } from "./FormAlert.component";
import { OverlapPreview } from "./OverlapPreview.component";
import type { ServerError } from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

export interface AddGroupMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onSearchEntities: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  selectedEntityId: string | null;
  onEntityChange: (value: string | null) => void;
  selectedFieldMappingId: string | null;
  onFieldMappingChange: (value: string | null) => void;
  isPrimary: boolean;
  onPrimaryChange: (checked: boolean) => void;
  overlap: EntityGroupMemberOverlapResponsePayload | null;
  overlapLoading: boolean;
  onAddMember: () => void;
  isAdding: boolean;
  serverError?: ServerError | null;
}

export const AddGroupMemberDialog: React.FC<AddGroupMemberDialogProps> = ({
  open,
  onClose,
  onSearchEntities,
  onSearchFieldMappings,
  selectedEntityId,
  onEntityChange,
  selectedFieldMappingId,
  onFieldMappingChange,
  isPrimary,
  onPrimaryChange,
  overlap,
  overlapLoading,
  onAddMember,
  isAdding,
  serverError,
}) => {
  const addDisabled = !selectedEntityId || !selectedFieldMappingId || isAdding;
  const entityInputRef = useDialogAutoFocus(open);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Member"
      maxWidth="sm"
      fullWidth
      onSubmit={onAddMember}
      submitDisabled={addDisabled}
      pending={isAdding}
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isAdding}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={() => {
              if (!addDisabled) onAddMember();
            }}
            disabled={addDisabled}
          >
            Submit
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <AsyncSearchableSelect
          inputRef={entityInputRef}
          value={selectedEntityId}
          onChange={onEntityChange}
          onSearch={onSearchEntities}
          label="Connector Entity"
          placeholder="Search entities…"
        />
        <AsyncSearchableSelect
          value={selectedFieldMappingId}
          onChange={onFieldMappingChange}
          onSearch={onSearchFieldMappings}
          label="Link Field Mapping"
          placeholder="Search field mappings…"
          disabled={!selectedEntityId}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={isPrimary}
              onChange={(e) => onPrimaryChange(e.target.checked)}
            />
          }
          label="Primary member"
        />
        <OverlapPreview overlap={overlap} isLoading={overlapLoading} />
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
