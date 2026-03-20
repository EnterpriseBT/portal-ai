import React from "react";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import SettingsIcon from "@mui/icons-material/Settings";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";

// ── Types ───────────────────────────────────────────────────────────

export interface DataTableColumn {
  /** Unique key used to look up the value in each row. */
  key: string;
  /** Display label for the column header. */
  label: string;
  /** Whether this column supports sorting. Default: `false`. */
  sortable?: boolean;
  /** Optional formatter — receives the raw cell value, returns a display string. */
  format?: (value: unknown) => string;
  /**
   * Optional custom cell renderer — receives the cell value and the full row,
   * returns arbitrary React content. Takes precedence over `format`.
   */
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
  /** Called when this cell is clicked. Stops propagation so the row handler does not fire. */
  onCellClick?: (value: unknown, column: DataTableColumn, row: Record<string, unknown>) => void;
}

export interface DataTableProps {
  /** Column definitions. */
  columns: DataTableColumn[];
  /** Row data — each entry is a key→value map matching column keys. */
  rows: Record<string, unknown>[];
  /** Currently sorted column key. */
  sortColumn?: string;
  /** Current sort direction. */
  sortDirection?: "asc" | "desc";
  /** Called when a column header is clicked for sorting. */
  onSort?: (column: string) => void;
  /** Message shown when rows is empty. Default: `"No data"`. */
  emptyMessage?: string;
  /** Optional custom header rendered above the table. */
  header?: React.ReactNode;
  /** Column configuration state — ordered list of `{ key, visible }`. */
  columnConfig?: ColumnConfig[];
  /** Called when the user changes column visibility or order. */
  onColumnConfigChange?: (config: ColumnConfig[]) => void;
  /** Called when a row is clicked. Does not fire if the clicked cell's column defines `onCellClick`. */
  onRowClick?: (row: Record<string, unknown>, index: number) => void;
}

export interface ColumnConfig {
  key: string;
  visible: boolean;
}

// ── Hook ────────────────────────────────────────────────────────────

export interface UseColumnConfigOptions {
  /** Pre-loaded config (e.g. from storage). Takes precedence over deriving from columns. */
  initialValue?: ColumnConfig[];
  /** Called whenever the config changes — use to persist to storage. */
  onPersist?: (config: ColumnConfig[]) => void;
  /**
   * When no `initialValue` is provided, only the first N columns will be
   * visible by default. If omitted or `undefined`, all columns are visible.
   */
  defaultVisibleCount?: number;
}

/**
 * Manages column visibility and order state.
 * Initialise from a `DataTableColumn[]` array — all columns visible by default.
 * Pass `initialValue` to restore from storage, and `onPersist` to save changes.
 */
export function useColumnConfig(
  columns: DataTableColumn[],
  options?: UseColumnConfigOptions
): [ColumnConfig[], (config: ColumnConfig[]) => void] {
  const { initialValue, onPersist, defaultVisibleCount } = options ?? {};

  const [config, setConfigState] = React.useState<ColumnConfig[]>(
    () =>
      initialValue ??
      columns.map((c, i) => ({
        key: c.key,
        visible: defaultVisibleCount == null || i < defaultVisibleCount,
      }))
  );

  // Sync when the column set changes (new columns appear, old ones removed)
  React.useEffect(() => {
    setConfigState((prev) => {
      const existing = new Map(prev.map((c) => [c.key, c]));
      const incoming = new Set(columns.map((c) => c.key));

      const kept = prev.filter((c) => incoming.has(c.key));
      const visibleCount = kept.filter((c) => c.visible).length;
      const added = columns
        .filter((c) => !existing.has(c.key))
        .map((c) => ({
          key: c.key,
          visible: defaultVisibleCount == null || visibleCount < defaultVisibleCount,
        }));

      return [...kept, ...added];
    });
  }, [columns, defaultVisibleCount]);

  const setConfig = React.useCallback(
    (next: ColumnConfig[]) => {
      setConfigState(next);
      onPersist?.(next);
    },
    [onPersist]
  );

  return [config, setConfig];
}

// ── Sortable item ───────────────────────────────────────────────────

interface SortableColumnItemProps {
  item: ColumnConfig;
  label: string;
  onToggle: (key: string) => void;
}

const SortableColumnItem: React.FC<SortableColumnItemProps> = ({
  item,
  label,
  onToggle,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      dense
      disableGutters
      sx={{ px: 1 }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: 0.5,
        }}
      >
        <Box
          {...attributes}
          {...listeners}
          sx={{
            display: "flex",
            alignItems: "center",
            cursor: isDragging ? "grabbing" : "grab",
            color: "text.secondary",
          }}
          aria-label={`Drag to reorder ${label}`}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={item.visible}
              onChange={() => onToggle(item.key)}
            />
          }
          label={label}
          sx={{ flex: 1, mr: 0 }}
        />
      </Box>
    </ListItem>
  );
};

// ── Column config menu ──────────────────────────────────────────────

interface ColumnConfigMenuProps {
  columns: DataTableColumn[];
  config: ColumnConfig[];
  onChange: (config: ColumnConfig[]) => void;
}

const ColumnConfigMenu: React.FC<ColumnConfigMenuProps> = ({
  columns,
  config,
  onChange,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const columnLabelMap = React.useMemo(
    () => new Map(columns.map((c) => [c.key, c.label])),
    [columns]
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleToggle = (key: string) => {
    onChange(
      config.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c))
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = config.findIndex((c) => c.key === active.id);
    const newIndex = config.findIndex((c) => c.key === over.id);
    onChange(arrayMove(config, oldIndex, newIndex));
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label="Configure columns"
      >
        <SettingsIcon fontSize="small" />
      </IconButton>
      <Popover
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={config.map((c) => c.key)}
            strategy={verticalListSortingStrategy}
          >
            <List dense sx={{ minWidth: 200 }}>
              {config.map((item) => (
                <SortableColumnItem
                  key={item.key}
                  item={item}
                  label={columnLabelMap.get(item.key) ?? item.key}
                  onToggle={handleToggle}
                />
              ))}
            </List>
          </SortableContext>
        </DndContext>
      </Popover>
    </>
  );
};

// ── DataTable ───────────────────────────────────────────────────────

export const DataTable = React.forwardRef<HTMLDivElement, DataTableProps>(
  (
    {
      columns,
      rows,
      sortColumn,
      sortDirection,
      onSort,
      emptyMessage = "No data",
      header,
      columnConfig,
      onColumnConfigChange,
      onRowClick,
    },
    ref
  ) => {
    // Resolve visible columns in config order
    const visibleColumns = React.useMemo(() => {
      if (!columnConfig) return columns;

      const columnMap = new Map(columns.map((c) => [c.key, c]));
      return columnConfig
        .filter((c) => c.visible && columnMap.has(c.key))
        .map((c) => columnMap.get(c.key)!);
    }, [columns, columnConfig]);

    if (visibleColumns.length === 0 && rows.length === 0) {
      return (
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ py: 4, textAlign: "center" }}
        >
          {emptyMessage}
        </Typography>
      );
    }

    return (
      <Box ref={ref}>
        {(header || (columnConfig && onColumnConfigChange)) && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              mb: 1,
            }}
          >
            <Box sx={{ flex: 1 }}>{header}</Box>
            {columnConfig && onColumnConfigChange && (
              <Box alignSelf={"flex-end"}>
                <ColumnConfigMenu
                  columns={columns}
                  config={columnConfig}
                  onChange={onColumnConfigChange}
                />
              </Box>
            )}
          </Box>
        )}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {visibleColumns.map((col) => (
                  <TableCell key={col.key}>
                    {onSort && col.sortable ? (
                      <TableSortLabel
                        active={sortColumn === col.key}
                        direction={
                          sortColumn === col.key
                            ? (sortDirection ?? "asc")
                            : "asc"
                        }
                        onClick={() => onSort(col.key)}
                      >
                        {col.label}
                      </TableSortLabel>
                    ) : (
                      col.label
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumns.length}
                    sx={{ textAlign: "center", py: 4 }}
                  >
                    <Typography variant="body1" color="text.secondary">
                      {emptyMessage}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow
                    key={idx}
                    onClick={onRowClick ? () => onRowClick(row, idx) : undefined}
                    sx={
                      onRowClick
                        ? {
                            cursor: "pointer",
                            "&:hover": { backgroundColor: "action.hover" },
                          }
                        : undefined
                    }
                  >
                    {visibleColumns.map((col) => (
                      <TableCell
                        key={col.key}
                        onClick={
                          col.onCellClick
                            ? (e) => {
                                e.stopPropagation();
                                col.onCellClick!(row[col.key], col, row);
                              }
                            : undefined
                        }
                        sx={
                          col.onCellClick
                            ? {
                                cursor: "pointer",
                                "&:hover": { backgroundColor: "action.selected" },
                              }
                            : undefined
                        }
                      >
                        {col.render
                          ? col.render(row[col.key], row)
                          : col.format
                            ? col.format(row[col.key])
                            : row[col.key] == null
                              ? "—"
                              : String(row[col.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }
);

DataTable.displayName = "DataTable";
