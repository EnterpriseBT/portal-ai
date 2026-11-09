import React from "react";
import Box from "@mui/material/Box";
import MuiTypography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";

export interface PageEmptyStateProps {
  /** Large icon displayed above the title. Accepts any React node. */
  icon?: React.ReactNode;
  /** Primary message. */
  title: string;
  /** Optional secondary description below the title. */
  description?: string;
  /** Optional call-to-action rendered below the description (e.g. a Button). */
  action?: React.ReactNode;
  className?: string;
  [key: `data-${string}`]: string;
}

export const PageEmptyState = React.forwardRef<
  HTMLDivElement,
  PageEmptyStateProps
>(({ icon, title, description, action, className, ...rest }, ref) => {
  return (
    <Box
      ref={ref}
      className={className}
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        py: 3,
        px: 3,
      }}
      {...rest}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 420 }}>
        {icon && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "text.disabled",
              fontSize: "3rem",
            }}
          >
            {icon}
          </Box>
        )}
        {/* #794: the title sits directly under the page's h1, so it's an
            h2 (h6 broke heading order); it keeps the h6 look. */}
        <MuiTypography
          variant="h6"
          component="h2"
          color="text.secondary"
          textAlign="center"
        >
          {title}
        </MuiTypography>
        {description && (
          <MuiTypography
            variant="body2"
            color="text.secondary"
            textAlign="center"
          >
            {description}
          </MuiTypography>
        )}
        {action && <Box sx={{ mt: 1 }}>{action}</Box>}
      </Stack>
    </Box>
  );
});

export default PageEmptyState;
