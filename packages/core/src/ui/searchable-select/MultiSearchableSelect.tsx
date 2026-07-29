import React from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import type { SelectOption, SelectBaseProps } from "./types.js";

export interface MultiSearchableSelectProps extends SelectBaseProps {
  options: SelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
}

export const MultiSearchableSelect: React.FC<MultiSearchableSelectProps> = ({
  options,
  value,
  onChange,
  label,
  placeholder,
  helperText,
  error,
  disabled,
  required,
  size = "small",
  fullWidth,
  inputRef,
}) => {
  const selectedOptions = value
    .map((v) => options.find((o) => String(o.value) === v))
    .filter((o): o is SelectOption => o != null);

  return (
    <MuiAutocomplete<SelectOption, true>
      multiple
      options={options}
      value={selectedOptions}
      onChange={(_event, selected) =>
        onChange(selected.map((o) => String(o.value)))
      }
      isOptionEqualToValue={(option, val) => option.value === val.value}
      getOptionLabel={(option) => option.label}
      getOptionDisabled={(option) => option.disabled === true}
      disabled={disabled}
      size={size}
      fullWidth={fullWidth}
      renderOption={(props, option) => {
        const { key, ...optionProps } =
          props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
        // A disabled option stays visible and states why — the alternative
        // (filtering it out) is a silent absence the user can't act on.
        // `renderTags` is deliberately untouched: an already-selected value
        // whose option is now disabled must remain removable.
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
      }}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              icon={
                option.icon ? (option.icon as React.ReactElement) : undefined
              }
              label={option.label}
              size={size}
              {...tagProps}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
          required={required}
        />
      )}
    />
  );
};
