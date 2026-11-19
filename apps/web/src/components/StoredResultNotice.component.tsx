import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { StatusMessage } from "@portalai/core/ui";

// #1038: a stored chart, table or map draws only what a live read returns.
// When there's nothing to draw, it says why, in place of the widget.

export interface StoredResultNoticeUIProps {
  /** `unavailable`: the reader can no longer read what the result reads.
   *  `not-kept`: the result had no recipe to re-run, so it wasn't stored. */
  reason: "unavailable" | "not-kept";
  /** The widget's title, kept so the reader knows which result this was. */
  title?: string;
}

const MESSAGES: Record<StoredResultNoticeUIProps["reason"], string> = {
  unavailable: "This result is no longer available to you.",
  "not-kept":
    "This result isn't kept after the conversation. Ask again to see it.",
};

export const StoredResultNoticeUI: React.FC<StoredResultNoticeUIProps> = ({
  reason,
  title,
}) => (
  <Box sx={{ p: 2 }} data-testid="stored-result-notice">
    {title ? (
      <Typography variant="subtitle2" component="p">
        {title}
      </Typography>
    ) : null}
    <StatusMessage variant="info" message={MESSAGES[reason]} />
  </Box>
);
