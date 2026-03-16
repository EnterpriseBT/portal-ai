import React from "react";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import MuiRadioGroup, {
  type RadioGroupProps as MuiRadioGroupProps,
} from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import FormHelperText from "@mui/material/FormHelperText";

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps
  extends Omit<MuiRadioGroupProps, "children"> {
  label?: string;
  options: RadioOption[];
  helperText?: string;
  error?: boolean;
  [key: `data-${string}`]: string;
}

export const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ label, options, helperText, error = false, ...props }, ref) => {
    return (
      <FormControl ref={ref} error={error}>
        {label && <FormLabel>{label}</FormLabel>}
        <MuiRadioGroup {...props}>
          {options.map((option) => (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={<Radio />}
              label={option.label}
              disabled={option.disabled}
            />
          ))}
        </MuiRadioGroup>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
      </FormControl>
    );
  }
);

export default RadioGroup;
