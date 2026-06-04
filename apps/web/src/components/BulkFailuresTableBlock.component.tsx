import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ReplayIcon from "@mui/icons-material/Replay";

// ── Types ──────────────────────────────────────────────────────────────

export interface BulkFailure {
  sourceKey: string;
  error: {
    code?: string;
    message?: string;
    recommendation?: string;
    details?: Record<string, unknown>;
  };
}

export interface BulkFailuresTableBlockContent {
  jobId: string;
  failures: BulkFailure[];
}

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface BulkFailuresTableBlockUIProps {
  content: BulkFailuresTableBlockContent;
  onRetryFailedOnly: (sourceKeys: string[]) => void;
  /** Set when an in-flight retry mutation is pending. */
  retrying?: boolean;
}

interface RowExpand {
  [key: string]: boolean;
}

export const BulkFailuresTableBlockUI: React.FC<
  BulkFailuresTableBlockUIProps
> = ({ content, onRetryFailedOnly, retrying }) => {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [expanded, setExpanded] = useState<RowExpand>({});

  const slice = content.failures.slice(
    page * perPage,
    page * perPage + perPage
  );

  const failedKeys = content.failures.map((f) => f.sourceKey);

  return (
    <Box
      data-testid="bulk-failures-table-block"
      sx={{
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        maxWidth: 720,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2">Per-record failures</Typography>
          <Chip
            size="small"
            label={`${content.failures.length} failed`}
            color="error"
          />
        </Stack>
        <Button
          size="small"
          startIcon={<ReplayIcon />}
          onClick={() => onRetryFailedOnly(failedKeys)}
          disabled={retrying || content.failures.length === 0}
          variant="outlined"
        >
          {retrying ? "Retrying…" : "Retry failed only"}
        </Button>
      </Stack>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>sourceKey</TableCell>
              <TableCell>code</TableCell>
              <TableCell>message</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {slice.map((f, i) => {
              const idx = page * perPage + i;
              const isOpen = !!expanded[idx];
              return (
                <React.Fragment key={`${f.sourceKey}-${idx}`}>
                  <TableRow hover>
                    <TableCell sx={{ width: 32 }}>
                      <IconButton
                        size="small"
                        aria-label={isOpen ? "Collapse row" : "Expand row"}
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [idx]: !prev[idx],
                          }))
                        }
                      >
                        {isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: "monospace" }}
                      >
                        {f.sourceKey}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={f.error.code ?? "ERROR"}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{f.error.message ?? "—"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      sx={{ p: 0, borderBottom: isOpen ? undefined : "none" }}
                    >
                      <Collapse in={isOpen} unmountOnExit>
                        <Box sx={{ p: 1.5 }}>
                          {f.error.recommendation && (
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Recommendation:</strong>{" "}
                              {f.error.recommendation}
                            </Typography>
                          )}
                          {f.error.details && (
                            <pre
                              style={{
                                fontSize: 12,
                                margin: 0,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {JSON.stringify(f.error.details, null, 2)}
                            </pre>
                          )}
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={content.failures.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={perPage}
        rowsPerPageOptions={[10, 25, 50]}
        onRowsPerPageChange={(e) => {
          setPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Box>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface BulkFailuresTableBlockProps {
  content: BulkFailuresTableBlockContent;
}

export const BulkFailuresTableBlock: React.FC<BulkFailuresTableBlockProps> = ({
  content,
}) => {
  // Retry flow is chat-driven (#85 Phase 4 spec § Retry-failed-only). For
  // now the button stub is wired up to a no-op; Phase 4 plumbs it
  // through the chat-message POST endpoint.
  const [retrying] = useState(false);

  const handleRetry = (_failedKeys: string[]) => {
    // Phase 4 wires this through `chat.postUserMessage` with a synthetic
    // retry message. Stubbed here to keep the UI affordance visible.
    void _failedKeys;
  };

  return (
    <BulkFailuresTableBlockUI
      content={content}
      onRetryFailedOnly={handleRetry}
      retrying={retrying}
    />
  );
};
