import React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";

import { DateFactory } from "../utils/date.factory.js";

/**
 * Shared freshness chrome for every visualization (#349).
 *
 * Before this, the header — title + "Updated X ago" + refresh button — was
 * hand-rolled three times (`MapWidget`, `D3Widget`, `PinnedResultDetail`), and
 * the table had none at all. Adding the degraded state to four hand-rolled
 * copies is how they drift, so the state machine lives here once and each
 * widget passes its own `refreshLabel`.
 *
 * Pure UI: it renders from props and holds no state, no data fetching, and no
 * knowledge of what it is describing.
 */

const STATUS_CHIP: Record<
  Exclude<NonNullable<WidgetFreshnessBarProps["status"]>, "ready">,
  { label: string; color: "default" | "info" | "warning" | "error" }
> = {
  loading: { label: "Loading", color: "default" },
  rendering: { label: "Rendering", color: "info" },
  refreshing: { label: "Refreshing", color: "info" },
  stale: { label: "Stale", color: "warning" },
  error: { label: "Error", color: "error" },
};

export interface WidgetFreshnessBarProps {
  title?: string;
  /** Epoch ms of the last hydration. Null/absent ⇒ no cue is rendered. */
  lastUpdatedAt?: number | null;
  isRefreshing?: boolean;
  /** The refresh affordance is available (a block ref and a pipeline exist). */
  canRefresh?: boolean;
  /**
   * The block predates durable pipelines. The cue still renders — the data has
   * a real age — but no refresh button, because nothing failed and there is
   * nothing to retry.
   */
  notRefreshable?: boolean;
  /**
   * The last refresh failed or was rate-limited. Replaces the plain cue with a
   * visible degraded chip while the widget keeps showing its last-good data.
   * Deliberately not a toast: a failing dependency across several widgets
   * would produce a storm.
   */
  degraded?: boolean;
  status?: "loading" | "rendering" | "refreshing" | "stale" | "error" | "ready";
  /** Tooltip + `aria-label` for the icon-only button, e.g. "Refresh table". */
  refreshLabel: string;
  onRefresh?: () => void;
}

export const WidgetFreshnessBar: React.FC<WidgetFreshnessBarProps> = ({
  title,
  lastUpdatedAt = null,
  isRefreshing = false,
  canRefresh = false,
  notRefreshable = false,
  degraded = false,
  status = "ready",
  refreshLabel,
  onRefresh,
}) => {
  const chip = status !== "ready" ? STATUS_CHIP[status] : null;
  const showRefresh = canRefresh && !notRefreshable && onRefresh != null;
  const showCue = lastUpdatedAt != null;

  // Nothing to say — render nothing rather than an empty row that still eats
  // vertical space above the widget.
  if (!title && !showCue && !chip && !showRefresh) return null;

  return (
    <Box
      sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
      data-testid="widget-freshness-bar"
    >
      {title ? (
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
      ) : (
        <Box sx={{ flex: 1, minWidth: 0 }} />
      )}

      {chip ? (
        <Chip
          size="small"
          variant="outlined"
          color={chip.color}
          label={chip.label}
          data-testid="widget-freshness-status"
        />
      ) : null}

      {showCue && degraded ? (
        <Chip
          size="small"
          variant="outlined"
          color="warning"
          label={`Couldn't update — showing data from ${DateFactory.relativeTime(
            lastUpdatedAt
          )}`}
          data-testid="widget-freshness-degraded"
        />
      ) : showCue ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="widget-freshness-updated"
        >
          Updated {DateFactory.relativeTime(lastUpdatedAt)}
        </Typography>
      ) : null}

      {showRefresh ? (
        <Tooltip title={refreshLabel}>
          <span>
            <IconButton
              size="small"
              aria-label={refreshLabel}
              disabled={isRefreshing}
              onClick={onRefresh}
              sx={{ flexShrink: 0 }}
            >
              {isRefreshing ? (
                <CircularProgress
                  size={14}
                  data-testid="widget-freshness-refreshing"
                />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
    </Box>
  );
};
