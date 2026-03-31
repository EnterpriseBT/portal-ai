import React from "react";
import Box from "@mui/material/Box";
import MuiTypography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";

import { Breadcrumbs } from "./Breadcrumbs.js";
import type { BreadcrumbItem, BreadcrumbsProps } from "./Breadcrumbs.js";
import { ActionsMenu } from "./ActionsMenu.js";
import type { ActionMenuItem } from "./ActionsMenu.js";

export { BreadcrumbItem };

export interface PageHeaderProps {
  /** Ordered breadcrumb trail from root to current page. */
  breadcrumbs?: BreadcrumbItem[];
  /** Called when a breadcrumb link is clicked. */
  onNavigate?: BreadcrumbsProps["onNavigate"];
  /** Page title displayed as h1. */
  title: string;
  /** Icon rendered before the title. Accepts any React node (e.g. MUI Icon or core Icon). */
  icon?: React.ReactNode;
  /** Primary call-to-action rendered at the trailing edge of the title row. */
  primaryAction?: React.ReactNode;
  /** Secondary actions rendered in a dropdown menu triggered by a "more" icon button. */
  secondaryActions?: ActionMenuItem[];
  /** Arbitrary content rendered below the title row (metadata, chips, description, etc.). */
  children?: React.ReactNode;
  /** Spacing between the children elements below the title row. Defaults to 1. */
  childrenSpacing?: number;
  className?: string;
  [key: `data-${string}`]: string;
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  (
    {
      breadcrumbs,
      onNavigate,
      title,
      icon,
      primaryAction,
      secondaryActions,
      children,
      childrenSpacing = 1,
      className,
      ...rest
    },
    ref,
  ) => {
    const hasSecondaryActions =
      secondaryActions && secondaryActions.length > 0;
    const hasActions = primaryAction || hasSecondaryActions;

    return (
      <Box ref={ref} className={className} {...rest}>
        <Stack spacing={1.5}>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <Breadcrumbs items={breadcrumbs} onNavigate={onNavigate} />
          )}

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
          >
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{ minWidth: 0 }}
            >
              {icon && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    color: "text.secondary",
                    fontSize: "2rem",
                  }}
                >
                  {icon}
                </Box>
              )}
              <MuiTypography
                variant="h1"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {title}
              </MuiTypography>
            </Stack>

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

          {children && <Stack spacing={childrenSpacing}>{children}</Stack>}
        </Stack>
      </Box>
    );
  },
);

export default PageHeader;
