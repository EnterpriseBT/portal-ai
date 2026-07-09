import React from "react";

import Typography from "@mui/material/Typography";

export interface MessageTimestampProps {
  /** Epoch-ms creation time of the message (or the send time for an in-flight,
   *  not-yet-persisted assistant message). */
  created: number;
  /** Right under the user bubble, left under assistant / streaming messages. */
  align?: "left" | "right";
}

// Short local date + time, e.g. "Jul 8, 2:34 PM". Rendered in the browser's
// own timezone + locale, so it's correct for the viewer (no UTC skew) and
// unambiguous across a local midnight — unlike a relative "1h ago", which
// reads as "today" by elapsed time even when it's yesterday on the local
// calendar (#180 smoke finding).
const SHORT_LABEL: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};
const FULL_TOOLTIP: Intl.DateTimeFormatOptions = {
  dateStyle: "full",
  timeStyle: "long",
};

/**
 * The per-message timestamp in a portal session — a text-thread-style local
 * date+time with the fully-qualified datetime (incl. timezone) on hover. Pure
 * UI: the label depends only on `created` and the browser's locale/timezone,
 * never on "now", so there's no relative-time drift and no cross-midnight
 * ambiguity.
 */
export const MessageTimestamp: React.FC<MessageTimestampProps> = ({
  created,
  align = "left",
}) => (
  <Typography
    variant="caption"
    color="text.secondary"
    title={new Intl.DateTimeFormat(undefined, FULL_TOOLTIP).format(created)}
    sx={{ display: "block", textAlign: align, mt: 0.25 }}
  >
    {new Intl.DateTimeFormat(undefined, SHORT_LABEL).format(created)}
  </Typography>
);
