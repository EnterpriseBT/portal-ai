import React from "react";

import { Icon, IconName, IconButton, TextInput } from "@portalai/core/ui";
import InputAdornment from "@mui/material/InputAdornment";

export interface HelpSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const HelpSearchBar: React.FC<HelpSearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search help",
}) => {
  return (
    <TextInput
      data-testid="help-search-bar"
      fullWidth
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Icon name={IconName.Search} fontSize="small" />
            </InputAdornment>
          ),
          endAdornment:
            value.length > 0 ? (
              <InputAdornment position="end">
                <IconButton
                  icon={IconName.Close}
                  size="small"
                  aria-label="Clear search"
                  onClick={() => onChange("")}
                />
              </InputAdornment>
            ) : undefined,
        },
      }}
    />
  );
};
