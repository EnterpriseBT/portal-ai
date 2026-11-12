import React, { useState, useMemo } from "react";

import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import SearchIcon from "@mui/icons-material/Search";
import { visuallyHidden } from "./visually-hidden.js";

const DEFAULT_ROWS_PER_PAGE = 10;
const ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50, 100];

type SortDirection = "asc" | "desc";

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Server paging (#796): `rows` is the current page and the parent owns it. */
export interface DataTableBlockPaging {
  /** Total rows across all pages. */
  total: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  /** A page is loading: the table reports `aria-busy`. */
  loading?: boolean;
}

export interface DataTableBlockProps {
  /** The table's accessible name (#794), also naming its search. */
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** Server-paged mode (#796). Search and sort are client-side over the rows
   *  held, so a partial result renders neither. Absent ⇒ unchanged. */
  paging?: DataTableBlockPaging;
}

export const DataTableBlock: React.FC<DataTableBlockProps> = ({
  label,
  columns,
  rows,
  paging,
}) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    // A server page is shown as given (#796): no client search over it.
    if (paging || !term) return rows;
    return rows.filter((row) =>
      columns.some((col) => {
        const val = row[col];
        if (val == null) return false;
        return String(val).toLowerCase().includes(term);
      })
    );
  }, [rows, columns, search, paging]);

  const sortedRows = useMemo(() => {
    if (paging || !sortColumn) return filteredRows;
    const sorted = [...filteredRows].sort((a, b) =>
      compareValues(a[sortColumn], b[sortColumn])
    );
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [filteredRows, sortColumn, sortDirection, paging]);

  const displayRows = paging
    ? rows
    : sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
    setPage(0);
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    if (paging) paging.onPageChange(newPage);
    else setPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const next = parseInt(event.target.value, 10);
    if (paging) {
      paging.onRowsPerPageChange(next);
      return;
    }
    setRowsPerPage(next);
    setPage(0);
  };

  const pagination = (
    <TablePagination
      component="div"
      count={paging ? paging.total : sortedRows.length}
      page={paging ? paging.page : page}
      onPageChange={handleChangePage}
      rowsPerPage={paging ? paging.rowsPerPage : rowsPerPage}
      onRowsPerPageChange={handleChangeRowsPerPage}
      rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
      // A server total runs to six figures; group its digits.
      labelDisplayedRows={
        paging
          ? ({ from, to, count }) =>
              `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${count.toLocaleString("en-US")}`
          : undefined
      }
      data-testid="table-pagination"
    />
  );

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setPage(0);
  };

  return (
    <Box sx={{ my: 1 }}>
      {paging ? (
        pagination
      ) : (
        <Box
          sx={{
            display: rows.length ? "flex" : "none",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
          }}
        >
          <TextField
            size="small"
            placeholder="Search..."
            value={search}
            onChange={handleSearchChange}
            slotProps={{
              htmlInput: { "aria-label": `Search ${label}` },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            data-testid="table-search"
            sx={{ minWidth: 200 }}
          />
          {sortedRows.length > ROWS_PER_PAGE_OPTIONS[0] && pagination}
        </Box>
      )}
      <TableContainer>
        <Table
          size="small"
          stickyHeader
          aria-busy={paging?.loading ? true : undefined}
        >
          <caption style={visuallyHidden}>{label}</caption>
          <TableHead>
            <TableRow>
              {columns.map((col) =>
                paging ? (
                  <TableCell key={col} sx={{ fontWeight: 600 }}>
                    {col}
                  </TableCell>
                ) : (
                  <TableCell
                    key={col}
                    sx={{ fontWeight: 600 }}
                    // MUI renders this as aria-sort on the header (#794).
                    sortDirection={sortColumn === col ? sortDirection : false}
                  >
                    <TableSortLabel
                      active={sortColumn === col}
                      direction={sortColumn === col ? sortDirection : "asc"}
                      onClick={() => handleSort(col)}
                    >
                      {col}
                    </TableSortLabel>
                  </TableCell>
                )
              )}
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
    </Box>
  );
};
