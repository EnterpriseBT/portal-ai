import React from "react";
import MuiButton from "@mui/material/Button";
import type { ButtonProps as MuiButtonProps } from "@mui/material/Button";

export type ButtonProps = MuiButtonProps;

export const Button = React.forwardRef<HTMLButtonElement, MuiButtonProps>(
  ({ children, variant = "contained", ...props }, ref) => {
    return (
      <MuiButton ref={ref} variant={variant} {...props}>
        {children}
      </MuiButton>
    );
  }
);
