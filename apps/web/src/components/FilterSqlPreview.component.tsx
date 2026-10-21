import React from "react";

import type { CuratedViewFilterSqlPreviewResponsePayload } from "@portalai/core/contracts";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface FilterSqlPreviewUIProps {
  pending: boolean;
  serverError: ServerError | null;
  /** The last preview's rows; null before the first run. */
  result: CuratedViewFilterSqlPreviewResponsePayload | null;
}

/** A cell as text: JSON for objects and arrays, empty for null. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * #644: the first rows a draft SQL filter selects. Loading, error, empty and
 * rows states; no total is shown because none is counted.
 */
export const FilterSqlPreviewUI: React.FC<FilterSqlPreviewUIProps> = ({
  pending,
  serverError,
  result,
}) => {
  if (pending) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }} role="status">
        <CircularProgress size={16} />
        <Typography variant="body2">Running the filter…</Typography>
      </Box>
    );
  }
  if (serverError) return <FormAlert serverError={serverError} />;
  if (!result) return null;
  if (result.records.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No rows match this filter.
      </Typography>
    );
  }
  return (
    <Box>
      <TableContainer sx={{ maxHeight: 280, overflowX: "auto" }}>
        <Table size="small" stickyHeader aria-label="Filter preview">
          <TableHead>
            <TableRow>
              {result.columns.map((c) => (
                <TableCell key={c.normalizedKey}>{c.normalizedKey}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {result.records.map((row) => (
              <TableRow key={String(row._record_id)}>
                {result.columns.map((c) => (
                  <TableCell key={c.normalizedKey}>
                    {cellText(row[c.normalizedKey])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">
        {result.hasMore
          ? `The first ${result.records.length} matching rows. More rows match.`
          : `${result.records.length} matching ${result.records.length === 1 ? "row" : "rows"}.`}
      </Typography>
    </Box>
  );
};
