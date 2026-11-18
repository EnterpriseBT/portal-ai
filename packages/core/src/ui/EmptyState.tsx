import React from "react";
import Box from "@mui/material/Box";
import MuiButton from "@mui/material/Button";
import MuiTypography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";

import { Icon, IconName } from "./Icon.js";

export interface EmptyStateProps {
  /** Large icon displayed above the title. Accepts any React node. */
  icon?: React.ReactNode;
  /** Primary message. */
  title: string;
  /** Optional secondary description below the title. */
  description?: string;
  /**
   * #1059: the Help entry that explains this list, rendered after the
   * description as a help-icon button named by `label`. Every top-level
   * list passes one, so an empty page says what it's for and where to read more.
   */
  helpLink?: { href: string; label: string };
  /** The app's router link for `helpLink` (core can't import the router). */
  linkComponent?: React.ElementType;
  /** Optional call-to-action rendered below the description (e.g. a Button). */
  action?: React.ReactNode;
  className?: string;
  [key: `data-${string}`]: string;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
      icon,
      title,
      description,
      helpLink,
      linkComponent,
      action,
      className,
      ...rest
    },
    ref
  ) => {
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
          {/* #1059: a compact outlined button led by a help icon, named by
              the question alone (the icon is decorative). It navigates, so it
              renders as a link through the app's router component. */}
          {helpLink && (
            <MuiButton
              component={linkComponent ?? "a"}
              href={helpLink.href}
              variant="outlined"
              size="small"
              startIcon={<Icon name={IconName.HelpOutline} />}
            >
              {helpLink.label}
            </MuiButton>
          )}
          {action && <Box sx={{ mt: 1 }}>{action}</Box>}
        </Stack>
      </Box>
    );
  }
);

export default EmptyState;
