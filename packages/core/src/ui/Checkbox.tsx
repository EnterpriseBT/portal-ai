import React from "react";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiCheckbox, {
  type CheckboxProps as MuiCheckboxProps,
} from "@mui/material/Checkbox";
import FormHelperText from "@mui/material/FormHelperText";
import FormControl from "@mui/material/FormControl";

export interface CheckboxProps extends Omit<MuiCheckboxProps, "onChange"> {
  label?: React.ReactNode;
  helperText?: string;
  error?: boolean;
  onChange?: (
    checked: boolean,
    event: React.ChangeEvent<HTMLInputElement>
  ) => void;
  [key: `data-${string}`]: string;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ label, helperText, error = false, onChange, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event.target.checked, event);
    };

    const checkbox = (
      <MuiCheckbox ref={ref} onChange={handleChange} {...props} />
    );

    if (!label && !helperText) {
      return checkbox;
    }

    return (
      <FormControl error={error}>
        {label ? (
          <FormControlLabel control={checkbox} label={label} />
        ) : (
          checkbox
        )}
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
      </FormControl>
    );
  }
);

export default Checkbox;
