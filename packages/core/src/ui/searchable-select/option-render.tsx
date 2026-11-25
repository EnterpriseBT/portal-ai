import React from "react";
import type { AutocompleteRenderGetTagProps } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";

import type { SelectOption } from "./types.js";

/**
 * An option's icon as a Chip can take it. Chip clones its icon, which
 * throws on a string, a number or anything else that isn't an element.
 */
export const optionChipIcon = (
  icon: React.ReactNode
): React.ReactElement | undefined =>
  React.isValidElement(icon) ? icon : undefined;

/**
 * One option row for every searchable select's `renderOption`: its icon,
 * then its label (a tag's colour dot, #1115). A disabled option stays
 * visible and states why, since filtering it out is a silent absence the
 * user can't act on.
 */
export const renderOptionRow = (
  props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key },
  option: SelectOption
): React.ReactNode => {
  const { key, ...optionProps } = props;
  const showReason = option.disabled === true && !!option.disabledReason;
  return (
    <Box
      component="li"
      key={key}
      {...optionProps}
      sx={{ display: "flex", alignItems: "center", gap: 1 }}
    >
      {option.icon}
      {showReason ? (
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <span>{option.label}</span>
          <Typography variant="caption" color="text.secondary">
            {option.disabledReason}
          </Typography>
        </Box>
      ) : (
        <span>{option.label}</span>
      )}
    </Box>
  );
};

/**
 * A multi-select's picked values as chips, each with its option's icon.
 * A chip ignores `disabled`: a picked value whose option is now disabled
 * must stay removable.
 */
export const renderOptionChips =
  (size: "small" | "medium") =>
  (
    tagValue: SelectOption[],
    getTagProps: AutocompleteRenderGetTagProps
  ): React.ReactNode =>
    tagValue.map((option, index) => {
      const { key, ...tagProps } = getTagProps({ index });
      return (
        <Chip
          key={key}
          icon={optionChipIcon(option.icon)}
          label={option.label}
          size={size}
          {...tagProps}
        />
      );
    });
