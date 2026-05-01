import React from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import { Box, Button, Modal, Stack, Typography } from "@portalai/core/ui";

import type {
  PreviewColumn,
  PreviewResult,
  PreviewValue,
} from "./utils/preview-records.util";

export interface RecordsPreviewDialogUIProps {
  open: boolean;
  onClose: () => void;
  /**
   * When null, the dialog renders an empty state — this covers the case where
   * the user clicks Preview on a region that has no segments, or before the
   * sheet data is ready.
   */
  preview: PreviewResult | null;
  /** Entity label shown in the dialog title, e.g. "Contact (preview)". */
  entityLabel?: string;
  sheetName?: string;
}

function formatValue(value: PreviewValue): {
  text: string;
  placeholder: boolean;
} {
  if (value === null || value === undefined) {
    return { text: "—", placeholder: true };
  }
  if (typeof value === "number") {
    return { text: String(value), placeholder: false };
  }
  const text = String(value).trim();
  if (!text) return { text: "—", placeholder: true };
  return { text, placeholder: false };
}

export const RecordsPreviewDialogUI: React.FC<RecordsPreviewDialogUIProps> = ({
  open,
  onClose,
  preview,
  entityLabel,
  sheetName,
}) => {
  const title = entityLabel
    ? `Preview records — ${entityLabel}`
    : "Preview records";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maximizable
      fullWidth
      maxWidth="lg"
      actions={
        <Button type="button" variant="text" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Stack spacing={1.5} sx={{ minHeight: 120 }}>
        {preview && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="caption" color="text.secondary">
              {preview.shape}
            </Typography>
            {sheetName && (
              <Typography variant="caption" color="text.secondary">
                · Sheet: {sheetName}
              </Typography>
            )}
            {preview.truncated && (
              <Typography variant="caption" color="text.secondary">
                · Showing the first {preview.rows.length} records only
              </Typography>
            )}
          </Stack>
        )}

        {preview?.notes?.length ? (
          <Stack spacing={0.5}>
            {preview.notes.map((n, i) => (
              <Typography key={i} variant="caption" color="text.secondary">
                {n}
              </Typography>
            ))}
          </Stack>
        ) : null}

        {renderBody(preview)}

        <Typography variant="caption" color="text.secondary">
          Placeholder labels (shown dimmed / italic) mark fields that don&apos;t
          yet have a labelled header — edit the header cells or rename the
          pivot axis to replace them.
        </Typography>
      </Stack>
    </Modal>
  );
};

function renderBody(preview: PreviewResult | null): React.ReactElement {
  if (!preview) {
    return (
      <EmptyPanel
        message="Add a header axis or draw a region with data to preview records."
      />
    );
  }
  if (preview.columns.length === 0) {
    return (
      <EmptyPanel message="No fields are derivable from the current region layout." />
    );
  }
  if (preview.rows.length === 0) {
    return (
      <EmptyPanel message="The region has no data rows yet — draw over some cells to populate the preview." />
    );
  }
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="Records preview">
        <TableHead>
          <TableRow>
            {preview.columns.map((col) => (
              <PreviewHeaderCell key={col.key} column={col} />
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {preview.rows.map((row, i) => (
            <TableRow key={i} hover>
              {preview.columns.map((col) => (
                <PreviewBodyCell
                  key={col.key}
                  value={row[col.key] ?? null}
                />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const EmptyPanel: React.FC<{ message: string }> = ({ message }) => (
  <Box
    role="status"
    sx={{
      p: 3,
      borderRadius: 1,
      border: "1px dashed",
      borderColor: "divider",
      backgroundColor: "background.paper",
      textAlign: "center",
    }}
  >
    <Typography variant="body2" color="text.secondary">
      {message}
    </Typography>
  </Box>
);

const PreviewHeaderCell: React.FC<{ column: PreviewColumn }> = ({ column }) => (
  <TableCell
    sx={{
      fontWeight: 700,
      whiteSpace: "nowrap",
      fontStyle: column.placeholder ? "italic" : "normal",
      color: column.placeholder ? "text.secondary" : "text.primary",
    }}
    title={column.placeholder ? "Placeholder — no labelled header" : undefined}
  >
    {column.label}
    {column.placeholder && (
      <Typography
        component="span"
        variant="caption"
        sx={{ ml: 0.75, color: "text.disabled", fontStyle: "italic" }}
      >
        (placeholder)
      </Typography>
    )}
  </TableCell>
);

const PreviewBodyCell: React.FC<{ value: PreviewValue }> = ({ value }) => {
  const { text, placeholder } = formatValue(value);
  return (
    <TableCell
      sx={{
        whiteSpace: "nowrap",
        fontFamily: "monospace",
        fontSize: 12,
        color: placeholder ? "text.disabled" : "text.primary",
        fontStyle: placeholder ? "italic" : "normal",
      }}
    >
      {text}
    </TableCell>
  );
};
