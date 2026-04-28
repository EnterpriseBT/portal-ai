import React from "react";
import MuiTypography from "@mui/material/Typography";
import type { TypographyProps as MuiTypographyProps } from "@mui/material/Typography";

export type TypographyProps = MuiTypographyProps;

export const Typography = React.forwardRef<HTMLElement, TypographyProps>(
  ({ children, ...props }, ref) => {
    return (
      <MuiTypography ref={ref} {...props}>
        {children}
      </MuiTypography>
    );
  }
);

export default Typography;
