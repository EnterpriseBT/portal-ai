import React from "react";

import { Box, visuallyHidden } from "@portalai/core/ui";

import { NOTIFICATIONS_ID } from "../utils/notifications-root.util";
import { useToastPresence } from "../utils/toast.context";
import { useUpdateNotice } from "../utils/update-notice.context";

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

/**
 * The page's skip links: the main content always, and the notifications
 * while a toast or the update notice is shown (#797). Notices never take
 * focus themselves, so this is how a keyboard user reaches a persistent
 * error without tabbing through the whole page.
 */
export const SkipLinks: React.FC = () => {
  const toasts = useToastPresence();
  const { open: updateOpen } = useUpdateNotice();
  const targets: SkipLinkTarget[] = [
    { id: MAIN_CONTENT_ID, label: "Skip to main content" },
  ];
  if (toasts > 0 || updateOpen) {
    targets.push({ id: NOTIFICATIONS_ID, label: "Skip to notifications" });
  }
  return <SkipLinksUI targets={targets} />;
};
