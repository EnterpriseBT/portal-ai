import React from "react";

import { useForkRef } from "@mui/material";

import { AsyncSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { UnauthorizedState } from "./UnauthorizedState.component";

export interface TagAssignSelectUIProps {
  onSearch: (query: string) => Promise<SelectOption[]>;
  onAssign: (entityTagId: string) => void;
  /** #630: false when the caller can't `read` tags — shows an unauthorized
   *  panel in place of the picker. Defaults true. */
  canRead?: boolean;
  /** Receives the search input too, e.g. for a dialog's auto-focus. */
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * A tag picker that assigns the picked tag and clears itself (#1070).
 *
 * The select keeps its own record of the picked option and shows it as a
 * removable chip, which an outside `value` of null doesn't clear. Left
 * there, that chip reads as one of the object's tags, and its ✕ removes
 * nothing. So each pick remounts the select empty, with focus back in the
 * field for the next pick.
 */
export const TagAssignSelectUI: React.FC<TagAssignSelectUIProps> = ({
  onSearch,
  onAssign,
  canRead = true,
  inputRef: outerRef,
}) => {
  const [picks, setPicks] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Our own ref refocuses after a pick; an outer one (a dialog's
  // auto-focus) gets the same element.
  const setInput = useForkRef(inputRef, outerRef);

  React.useEffect(() => {
    if (picks > 0) inputRef.current?.focus();
  }, [picks]);

  const handleChange = (newValue: string | null) => {
    if (!newValue) return;
    onAssign(newValue);
    setPicks((n) => n + 1);
  };

  if (!canRead) {
    return (
      <UnauthorizedState message="You don't have permission to view tags." />
    );
  }

  return (
    <AsyncSearchableSelect
      key={picks}
      value={null}
      onChange={handleChange}
      onSearch={onSearch}
      inputRef={setInput}
      label="Add tag"
      placeholder="Search tags…"
      size="small"
    />
  );
};
