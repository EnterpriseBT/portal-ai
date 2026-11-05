import React from "react";

import { Box, visuallyHidden } from "@portalai/core/ui";

export interface SkipLinkTarget {
  /** The id of the element to move focus to; it carries `tabIndex={-1}`. */
  id: string;
  label: string;
}

export interface SkipLinksUIProps {
  targets: SkipLinkTarget[];
}

/**
 * Bypass links (WCAG 2.4.1, #797): the first thing Tab reaches on every page.
 * Hidden until focused, then shown top-left above the header. Activating one
 * moves focus to its target, not only the scroll position, so the next Tab
 * continues from there.
 */
export const SkipLinksUI: React.FC<SkipLinksUIProps> = ({ targets }) => {
  const handleClick = (id: string) => (event: React.MouseEvent) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView?.({ block: "start" });
  };

  return (
    <Box component="nav" aria-label="Skip links">
      {targets.map((t) => (
        <Box
          key={t.id}
          component="a"
          href={`#${t.id}`}
          onClick={handleClick(t.id)}
          sx={(theme) => ({
            ...visuallyHidden,
            "&:focus": {
              clip: "auto",
              height: "auto",
              width: "auto",
              margin: 0,
              overflow: "visible",
              whiteSpace: "normal",
              position: "fixed",
              top: theme.spacing(1),
              left: theme.spacing(1),
              zIndex: theme.zIndex.tooltip + 1,
              padding: theme.spacing(1, 2),
              borderRadius: `${theme.shape.borderRadius}px`,
              background: theme.palette.background.paper,
              color: theme.palette.primary.main,
              boxShadow: theme.shadows[4],
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          })}
        >
          {t.label}
        </Box>
      ))}
    </Box>
  );
};

export const MAIN_CONTENT_ID = "main-content";

/** The page's skip links: the main content always. */
export const SkipLinks: React.FC = () => (
  <SkipLinksUI
    targets={[{ id: MAIN_CONTENT_ID, label: "Skip to main content" }]}
  />
);
