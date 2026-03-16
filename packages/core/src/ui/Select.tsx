import React from "react";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import MuiMenuItem from "@mui/material/MenuItem";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export type SelectProps = Omit<TextFieldProps, "select"> & {
  options: SelectOption[];
  placeholder?: string;
  [key: `data-${string}`]: string;
};

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  (
    { options, placeholder, variant = "outlined", size = "small", ...props },
    ref
  ) => {
    return (
      <TextField ref={ref} select variant={variant} size={size} {...props}>
        {placeholder && (
          <MuiMenuItem value="" disabled>
            {placeholder}
          </MuiMenuItem>
        )}
        {options.map((option) => (
          <MuiMenuItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </MuiMenuItem>
        ))}
      </TextField>
    );
  }
);

export default Select;
