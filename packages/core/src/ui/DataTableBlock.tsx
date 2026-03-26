import React from "react";

import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

const MAX_DISPLAY_ROWS = 50;

export interface DataTableBlockProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

export const DataTableBlock: React.FC<DataTableBlockProps> = ({
  columns,
  rows,
}) => {
  const totalRows = rows.length;
  const displayRows = rows.slice(0, MAX_DISPLAY_ROWS);
  const isTruncated = totalRows > MAX_DISPLAY_ROWS;

  return (
    <Box sx={{ my: 1 }}>
      <TableContainer sx={{ maxHeight: 400, overflow: "auto" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col} sx={{ fontWeight: 600 }}>
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {displayRows.map((row, rowIdx) => (
              <TableRow key={rowIdx}>
                {columns.map((col) => (
                  <TableCell key={col}>
                    {row[col] == null ? "" : String(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {isTruncated && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 0.5, display: "block" }}
          data-testid="row-count-label"
        >
          Showing {MAX_DISPLAY_ROWS} of {totalRows} rows
        </Typography>
      )}
    </Box>
  );
};
