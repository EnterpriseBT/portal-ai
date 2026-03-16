import React from "react";
import TextField, { type TextFieldProps } from "@mui/material/TextField";

export type TextInputProps = TextFieldProps & {
  [key: `data-${string}`]: string;
};

export const TextInput = React.forwardRef<HTMLDivElement, TextInputProps>(
  ({ variant = "outlined", size = "small", ...props }, ref) => {
    return <TextField ref={ref} variant={variant} size={size} {...props} />;
  }
);

export default TextInput;
