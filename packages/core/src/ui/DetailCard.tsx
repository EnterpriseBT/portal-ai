import React from "react";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import ButtonBase from "@mui/material/ButtonBase";
import MuiLink from "@mui/material/Link";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import MuiTypography from "@mui/material/Typography";

import { visibleActionItems } from "./ActionsMenu.js";
import { ActionsSuite } from "./ActionsSuite.js";
import { followClick, isControlClick } from "./click-target.js";
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
  /**
   * The card runs an action (opens a dialog): its title becomes a button.
   * For navigation pass `href` instead, so it's a link (#794).
   */
  onClick?: () => void;
  /** The card navigates: its title becomes a link to this href (#794). */
  href?: string;
  /** Element the title link renders as (the app passes its router link). Default `"a"`. */
  linkComponent?: React.ElementType;
  /**
   * The title's heading level (#793). A card's title is a heading, so
   * screen-reader users can move between cards; 3 sits under a page's h1 and
   * a section's h2. Pass 2 for cards directly under the page heading.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
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
      href,
      linkComponent,
      headingLevel = 3,
      variant = "outlined",
      className,
      ...rest
    },
    ref
  ) => {
    // #688: hidden actions don't count.
    const hasActions = visibleActionItems(actions).length > 0;
    const titleId = React.useId();
    const titleRef = React.useRef<HTMLElement>(null);
    const clickable = Boolean(href || onClick);
    const both = Boolean(href && onClick);
    // Said once, not per render: with both, the link wins and onClick never
    // runs.
    React.useEffect(() => {
      if (both && process.env.NODE_ENV !== "production") {
        console.error(
          "DetailCard: pass href or onClick, not both; onClick is ignored."
        );
      }
    }, [both]);

    // #794: the title is the card's one control, named by the title alone.
    // A click elsewhere on the card (outside its actions) activates it, so
    // the whole card stays a pointer target while hover content in the body
    // (tooltips) still works.
    // A Ctrl/Cmd or middle click opens a link card in a new tab.
    const followTitle = (e: React.MouseEvent<HTMLElement>) => {
      if (isControlClick(e.target, e.currentTarget)) return;
      followClick(titleRef.current, e);
    };

    const titleControl = href ? (
      <MuiLink
        ref={titleRef as React.Ref<HTMLAnchorElement>}
        component={linkComponent ?? "a"}
        href={href}
        color="inherit"
        underline="hover"
        data-card-title=""
      >
        {title}
      </MuiLink>
    ) : onClick ? (
      <ButtonBase
        ref={titleRef as React.Ref<HTMLButtonElement>}
        onClick={onClick}
        data-card-title=""
        // sx in core, with a reason: a title-styled button, not a box. Inline,
        // so the heading's ellipsis still truncates a long title.
        sx={{
          font: "inherit",
          textAlign: "left",
          verticalAlign: "baseline",
          display: "inline",
        }}
      >
        {title}
      </ButtonBase>
    ) : (
      title
    );

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
          // The theme maps subtitles to <p>; a card title is a heading.
          component={`h${headingLevel}`}
          id={titleId}
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 600,
          }}
        >
          {titleControl}
        </MuiTypography>
      </Stack>
    );

    const body = children ? <Box>{children}</Box> : null;

    return (
      <MuiCard
        ref={ref}
        variant={variant}
        className={className}
        onClick={clickable ? followTitle : undefined}
        onAuxClick={href ? followTitle : undefined}
        // sx in core, with a reason: a clickable card shows it's one target.
        sx={
          clickable
            ? {
                cursor: "pointer",
                "&:hover": { backgroundColor: "action.hover" },
              }
            : undefined
        }
        {...rest}
      >
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
                <ActionsSuite items={actions ?? []} describedBy={titleId} />
              </Box>
            )}
          </Stack>
        </CardContent>
      </MuiCard>
    );
  }
);

export default DetailCard;
