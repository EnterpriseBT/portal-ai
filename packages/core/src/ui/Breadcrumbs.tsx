import React from "react";
import MuiBreadcrumbs from "@mui/material/Breadcrumbs";
import type { BreadcrumbsProps as MuiBreadcrumbsProps } from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import MuiTypography from "@mui/material/Typography";

import { Icon } from "./Icon.js";
import type { IconName } from "./Icon.js";

export interface BreadcrumbItem {
  /** Display label for the breadcrumb. */
  label: string;
  /** Optional icon to display before the label. */
  icon?: IconName;
  /** If provided, the breadcrumb is clickable. Omit for the current (last) item. */
  href?: string;
}

export interface BreadcrumbsProps {
  /** Ordered list of breadcrumb items from root to current page. */
  items: BreadcrumbItem[];
  /** Called when a breadcrumb link is clicked. */
  onNavigate?: (href: string, event: React.MouseEvent) => void;
  /** MUI separator between items. Defaults to "/". */
  separator?: MuiBreadcrumbsProps["separator"];
  /** Maximum items to display before collapsing. */
  maxItems?: number;
  className?: string;
  [key: `data-${string}`]: string;
}

export const Breadcrumbs = React.forwardRef<HTMLElement, BreadcrumbsProps>(
  (
    { items, onNavigate, separator = "/", maxItems, className, ...rest },
    ref
  ) => {
    return (
      <MuiBreadcrumbs
        ref={ref}
        separator={separator}
        maxItems={maxItems}
        className={className}
        aria-label="breadcrumb"
        {...rest}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const icon = item.icon ? (
            <Icon name={item.icon} sx={{ fontSize: 18, mr: 0.5 }} />
          ) : null;

          if (isLast || !item.href) {
            return (
              <MuiTypography
                key={index}
                variant="inherit"
                color="text.primary"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  fontSize: 14,
                  lineHeight: "24px",
                }}
              >
                {icon}
                {item.label}
              </MuiTypography>
            );
          }

          return (
            <Link
              key={index}
              href={item.href}
              underline="hover"
              color="inherit"
              sx={{
                display: "flex",
                alignItems: "center",
                fontSize: 14,
                lineHeight: "24px",
              }}
              onClick={(event: React.MouseEvent) => {
                if (onNavigate) {
                  event.preventDefault();
                  onNavigate(item.href!, event);
                }
              }}
            >
              {icon}
              {item.label}
            </Link>
          );
        })}
      </MuiBreadcrumbs>
    );
  }
);

export default Breadcrumbs;
