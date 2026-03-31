import React from "react";
import Box from "@mui/material/Box";
import MuiTypography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";

import { ActionsMenu } from "./ActionsMenu.js";
import type { ActionMenuItem } from "./ActionsMenu.js";

export interface PageSectionProps {
  /** Section title displayed as h2. */
  title?: string;
  /** Icon rendered before the title. Accepts any React node (e.g. MUI Icon or core Icon). */
  icon?: React.ReactNode;
  /** Primary call-to-action rendered at the trailing edge of the title row. */
  primaryAction?: React.ReactNode;
  /** Secondary actions rendered in a dropdown menu triggered by a "more" icon button. */
  secondaryActions?: ActionMenuItem[];
  /** Section body content. */
  children: React.ReactNode;
  /** Visual variant. "outlined" wraps in an outlined Paper (default), "divider" uses a top divider. */
  variant?: "divider" | "outlined";
  /** Spacing between the title row and the body content. Defaults to 2. */
  spacing?: number;
  /** Optional padding applied inside the section (useful with "outlined" variant). */
  padding?: number;
  className?: string;
  [key: `data-${string}`]: string;
}

export const PageSection = React.forwardRef<HTMLDivElement, PageSectionProps>(
  (
    {
      title,
      icon,
      primaryAction,
      secondaryActions,
      children,
      variant = "outlined",
      spacing = 2,
      padding,
      className,
      ...rest
    },
    ref,
  ) => {
    const hasTitle = title !== undefined;
    const hasSecondaryActions =
      secondaryActions && secondaryActions.length > 0;
    const hasActions = primaryAction || hasSecondaryActions;
    const hasHeader = hasTitle || hasActions;

    const header = hasHeader ? (
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        {hasTitle && (
          <Stack direction="row" spacing={1} alignItems="center">
            {icon && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  color: "text.secondary",
                  fontSize: "1.5rem",
                }}
              >
                {icon}
              </Box>
            )}
            <MuiTypography variant="h2">{title}</MuiTypography>
          </Stack>
        )}

        {hasActions && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexShrink: 0 }}
          >
            {primaryAction}
            {hasSecondaryActions && (
              <ActionsMenu items={secondaryActions} />
            )}
          </Stack>
        )}
      </Stack>
    ) : null;

    const content = (
      <Stack spacing={hasHeader ? spacing : 0}>
        {variant === "divider" && hasHeader && <Divider />}
        {header}
        <Box>{children}</Box>
      </Stack>
    );

    if (variant === "outlined") {
      return (
        <Paper
          ref={ref}
          variant="outlined"
          className={className}
          sx={{ p: padding ?? 2.5 }}
          {...rest}
        >
          {content}
        </Paper>
      );
    }

    return (
      <Box ref={ref} className={className} {...rest}>
        {content}
      </Box>
    );
  },
);

export default PageSection;
