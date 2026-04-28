import React from "react";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import MuiTypography from "@mui/material/Typography";

import { ActionsSuite } from "./ActionsSuite.js";
import type { ActionSuiteItem } from "./ActionsSuite.js";

export interface DetailCardProps {
  /** Card title. */
  title: string;
  /** Optional icon rendered before the title. Accepts any React node. */
  icon?: React.ReactNode;
  /** Arbitrary body content rendered below the title row. */
  children?: React.ReactNode;
  /** Action buttons rendered at the trailing edge of the title row. */
  actions?: ActionSuiteItem[];
  /** When provided, the card becomes clickable and calls this handler. */
  onClick?: () => void;
  /** MUI Card variant. Defaults to "outlined". */
  variant?: "outlined" | "elevation";
  className?: string;
  [key: `data-${string}`]: string;
}

export const DetailCard = React.forwardRef<HTMLDivElement, DetailCardProps>(
  (
    {
      title,
      icon,
      children,
      actions,
      onClick,
      variant = "outlined",
      className,
      ...rest
    },
    ref
  ) => {
    const hasActions = actions && actions.length > 0;

    const titleRow = (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        {icon && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              color: "text.secondary",
              fontSize: "1.25rem",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
        <MuiTypography
          variant="subtitle1"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 600,
          }}
        >
          {title}
        </MuiTypography>
      </Stack>
    );

    const body = children ? <Box>{children}</Box> : null;

    if (onClick) {
      return (
        <MuiCard ref={ref} variant={variant} className={className} {...rest}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
          >
            <CardActionArea onClick={onClick} sx={{ flex: 1, minWidth: 0 }}>
              <CardContent>
                <Stack spacing={1.5}>
                  {titleRow}
                  {body}
                </Stack>
              </CardContent>
            </CardActionArea>

            {hasActions && (
              <Box
                sx={{
                  flexShrink: 0,
                  px: 2,
                  pt: { xs: 0.5, sm: 1 },
                  pb: { xs: 1.5, sm: 1 },
                }}
              >
                <ActionsSuite items={actions} />
              </Box>
            )}
          </Stack>
        </MuiCard>
      );
    }

    return (
      <MuiCard ref={ref} variant={variant} className={className} {...rest}>
        <CardContent>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
          >
            <Stack spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
              {titleRow}
              {body}
            </Stack>

            {hasActions && (
              <Box sx={{ flexShrink: 0 }}>
                <ActionsSuite items={actions} />
              </Box>
            )}
          </Stack>
        </CardContent>
      </MuiCard>
    );
  }
);

export default DetailCard;
