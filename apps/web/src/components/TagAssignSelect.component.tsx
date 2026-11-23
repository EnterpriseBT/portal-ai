import React from "react";

import { AsyncSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { UnauthorizedState } from "./UnauthorizedState.component";

export interface TagAssignSelectUIProps {
  onSearch: (query: string) => Promise<SelectOption[]>;
  onAssign: (entityTagId: string) => void;
  /** #630: false when the caller can't `read` tags — shows an unauthorized
   *  panel in place of the picker. Defaults true. */
  canRead?: boolean;
}

/** A tag picker that assigns the picked tag and clears itself (#1070). */
export const TagAssignSelectUI: React.FC<TagAssignSelectUIProps> = ({
  onSearch,
  onAssign,
  canRead = true,
}) => {
  const [value, setValue] = React.useState<string | null>(null);

  const handleChange = (newValue: string | null) => {
    if (newValue) onAssign(newValue);
    setValue(null);
  };

  if (!canRead) {
    return (
      <UnauthorizedState message="You don't have permission to view tags." />
    );
  }

  return (
    <AsyncSearchableSelect
      value={value}
      onChange={handleChange}
      onSearch={onSearch}
      label="Add tag"
      placeholder="Search tags…"
      size="small"
    />
  );
};
