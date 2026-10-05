import React from "react";

import type { PortalResultListResponsePayload } from "@portalai/core/contracts";
import { Box, DetailCard, Stack, Typography } from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import TextSnippetOutlinedIcon from "@mui/icons-material/TextSnippetOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import InsertChartOutlinedIcon from "@mui/icons-material/InsertChartOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import PushPinIcon from "@mui/icons-material/PushPin";

import DataResult from "./DataResult.component";
import { sdk } from "../api/sdk";
import type { PortalResultsListPayload } from "../api/portal-results.api";
import { decideActionGate } from "../utils/action-gate.util";

/** A pin list row, with the caller's capabilities on it (#688). */
type PinnedResultRow = PortalResultListResponsePayload["portalResults"][number];

// ── Result type icon ────────────────────────────────────────────────

function ResultTypeIcon({ type }: { type: string }) {
  if (type === "d3") {
    return <InsertChartOutlinedIcon fontSize="small" color="action" />;
  }
  if (type === "geo") {
    return <MapOutlinedIcon fontSize="small" color="action" />;
  }
  if (type === "data-table") {
    return <TableChartOutlinedIcon fontSize="small" color="action" />;
  }
  return <TextSnippetOutlinedIcon fontSize="small" color="action" />;
}

// ── Card UI (pure) ──────────────────────────────────────────────────

export interface PinnedResultCardUIProps {
  result: PinnedResultRow;
  onResultClick: (id: string) => void;
  onUnpin: (id: string) => void;
}

export const PinnedResultCardUI: React.FC<PinnedResultCardUIProps> = ({
  result,
  onResultClick,
  onUnpin,
}) => {
  const actions: ActionSuiteItem[] = [
    {
      label: "Unpin",
      icon: <PushPinIcon />,
      onClick: () => onUnpin(result.id),
      // #690: only on pins the caller may delete.
      gate: decideActionGate({ allowed: result.capabilities.delete }),
    },
  ];

  return (
    <DetailCard
      title={result.name}
      icon={<ResultTypeIcon type={result.type} />}
      onClick={() => onResultClick(result.id)}
      actions={actions}
      data-testid={`pinned-result-row-${result.id}`}
    >
      <Stack spacing={0.25}>
        {result.portalName && (
          <Typography variant="caption" color="text.secondary">
            from {result.portalName}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {DateFactory.relativeTime(result.created)}
        </Typography>
      </Stack>
    </DetailCard>
  );
};

// ── List UI (pure) ──────────────────────────────────────────────────

export interface PinnedResultsListUIProps {
  results: PinnedResultRow[];
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
  children: (
    data: ReturnType<typeof sdk.portalResults.list>
  ) => React.ReactNode;
}

const PinnedResultsData: React.FC<PinnedResultsDataProps> = ({ children }) => {
  const res = sdk.portalResults.list({
    limit: 5,
    offset: 0,
    include: "portal",
  });
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
              results={payload.portalResults as unknown as PinnedResultRow[]}
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
