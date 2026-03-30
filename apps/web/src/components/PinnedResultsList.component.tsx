import React from "react";

import type { PortalResult } from "@portalai/core/models";
import { Box, Stack, Typography } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import TextSnippetOutlinedIcon from "@mui/icons-material/TextSnippetOutlined";
import BarChartIcon from "@mui/icons-material/BarChart";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import PushPinIcon from "@mui/icons-material/PushPin";

import DataResult from "./DataResult.component";
import { sdk } from "../api/sdk";
import type { PortalResultsListPayload } from "../api/portal-results.api";

// ── Result type icon ────────────────────────────────────────────────

function ResultTypeIcon({ type }: { type: string }) {
  if (type === "vega-lite") {
    return <BarChartIcon fontSize="small" color="action" />;
  }
  if (type === "data-table") {
    return <TableChartOutlinedIcon fontSize="small" color="action" />;
  }
  return <TextSnippetOutlinedIcon fontSize="small" color="action" />;
}

// ── Card UI (pure) ──────────────────────────────────────────────────

export interface PinnedResultCardUIProps {
  result: PortalResult;
  onResultClick: (id: string) => void;
  onUnpin: (id: string) => void;
}

export const PinnedResultCardUI: React.FC<PinnedResultCardUIProps> = ({
  result,
  onResultClick,
  onUnpin,
}) => (
  <Card variant="outlined">
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "stretch", sm: "center" }}
    >
      <CardActionArea
        onClick={() => onResultClick(result.id)}
        data-testid={`pinned-result-row-${result.id}`}
        sx={{ flex: 1, minWidth: 0 }}
      >
        <CardContent sx={{ "&:last-child": { pb: 2 } }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
            <ResultTypeIcon type={result.type} />
            <Typography variant="subtitle2" noWrap>
              {result.name}
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: { xs: "block", sm: "none" }, mt: 0.5, ml: 4 }}
          >
            {DateFactory.relativeTime(result.created)}
          </Typography>
        </CardContent>
      </CardActionArea>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: { xs: "none", sm: "block" }, flexShrink: 0, mr: 1 }}
      >
        {DateFactory.relativeTime(result.created)}
      </Typography>
      <Tooltip title="Unpin result">
        <IconButton
          size="small"
          data-testid={`unpin-btn-${result.id}`}
          onClick={() => onUnpin(result.id)}
          sx={{
            mr: 1,
            alignSelf: { xs: "flex-end", sm: "center" },
            mb: { xs: 1, sm: 0 },
          }}
        >
          <PushPinIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  </Card>
);

// ── List UI (pure) ──────────────────────────────────────────────────

export interface PinnedResultsListUIProps {
  results: PortalResult[];
  onResultClick: (id: string) => void;
  onUnpin: (id: string) => void;
  onViewAll: () => void;
}

export const PinnedResultsListUI: React.FC<PinnedResultsListUIProps> = ({
  results,
  onResultClick,
  onUnpin,
  onViewAll,
}) => {
  if (results.length === 0) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ py: 4, textAlign: "center" }}
        data-testid="empty-pinned-results"
      >
        No pinned results yet — pin results from a portal session to see them
        here
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {results.map((result) => (
        <PinnedResultCardUI
          key={result.id}
          result={result}
          onResultClick={onResultClick}
          onUnpin={onUnpin}
        />
      ))}
      <Box sx={{ textAlign: "right" }}>
        <Typography
          variant="body2"
          color="primary"
          sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
          onClick={onViewAll}
          data-testid="view-all-pinned-results"
        >
          View All
        </Typography>
      </Box>
    </Stack>
  );
};

// ── Data component ──────────────────────────────────────────────────

interface PinnedResultsDataProps {
  children: (data: ReturnType<typeof sdk.portalResults.list>) => React.ReactNode;
}

const PinnedResultsData: React.FC<PinnedResultsDataProps> = ({ children }) => {
  const res = sdk.portalResults.list({ limit: 5, offset: 0 });
  return <>{children(res)}</>;
};

// ── Connected ───────────────────────────────────────────────────────

export interface PinnedResultsListConnectedProps {
  onResultClick: (id: string) => void;
  onUnpin: (id: string) => void;
  onViewAll: () => void;
}

export const PinnedResultsListConnected: React.FC<
  PinnedResultsListConnectedProps
> = ({ onResultClick, onUnpin, onViewAll }) => (
  <PinnedResultsData>
    {(result) => (
      <DataResult results={{ pinned: result }}>
        {(data) => {
          const payload = data.pinned as unknown as PortalResultsListPayload;
          return (
            <PinnedResultsListUI
              results={payload.portalResults as unknown as PortalResult[]}
              onResultClick={onResultClick}
              onUnpin={onUnpin}
              onViewAll={onViewAll}
            />
          );
        }}
      </DataResult>
    )}
  </PinnedResultsData>
);
