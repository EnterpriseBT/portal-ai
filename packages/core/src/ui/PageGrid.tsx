import React from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Breakpoint } from "@mui/material/styles";

/** Responsive value that can change per breakpoint. */
type ResponsiveValue<T> = T | Partial<Record<Breakpoint, T>>;

export interface PageGridProps {
  /** Grid children — typically `<PageGridItem>` elements. */
  children: React.ReactNode;
  /** Number of columns at each breakpoint. Defaults to `{ xs: 1, md: 2 }`. */
  columns?: ResponsiveValue<number>;
  /** Gap between grid cells (in theme spacing units). Defaults to 3. */
  spacing?: ResponsiveValue<number>;
  className?: string;
  [key: `data-${string}`]: string;
}

/**
 * Normalise a `ResponsiveValue<number>` into an `sx`-compatible responsive
 * `gridTemplateColumns` value.
 */
const toGridTemplate = (columns: ResponsiveValue<number>): SxProps<Theme> => {
  if (typeof columns === "number") {
    return { gridTemplateColumns: `repeat(${columns}, 1fr)` };
  }

  const result: Record<string, string> = {};
  for (const [bp, count] of Object.entries(columns)) {
    result[bp] = `repeat(${count}, 1fr)`;
  }
  return { gridTemplateColumns: result };
};

export const PageGrid = React.forwardRef<HTMLDivElement, PageGridProps>(
  (
    { children, columns = { xs: 1, md: 2 }, spacing = 3, className, ...rest },
    ref
  ) => {
    return (
      <Box
        ref={ref}
        className={className}
        sx={{
          display: "grid",
          gap: spacing,
          ...toGridTemplate(columns),
        }}
        {...rest}
      >
        {children}
      </Box>
    );
  }
);

/* ------------------------------------------------------------------ */

export interface PageGridItemProps {
  /** Content rendered inside the grid cell. */
  children: React.ReactNode;
  /** Number of columns this cell spans. Supports responsive values. */
  span?: ResponsiveValue<number>;
  /** Number of rows this cell spans. Supports responsive values. */
  rowSpan?: ResponsiveValue<number>;
  className?: string;
  [key: `data-${string}`]: string;
}

const toSpanValue = (
  value: ResponsiveValue<number>
): string | Record<string, string> => {
  if (typeof value === "number") {
    return `span ${value}`;
  }

  const result: Record<string, string> = {};
  for (const [bp, count] of Object.entries(value)) {
    result[bp] = `span ${count}`;
  }
  return result;
};

export const PageGridItem = React.forwardRef<HTMLDivElement, PageGridItemProps>(
  ({ children, span, rowSpan, className, ...rest }, ref) => {
    const sx: Record<string, unknown> = { minWidth: 0 };
    if (span) sx.gridColumn = toSpanValue(span);
    if (rowSpan) sx.gridRow = toSpanValue(rowSpan);

    return (
      <Box
        ref={ref}
        className={className}
        sx={Object.keys(sx).length > 0 ? sx : undefined}
        {...rest}
      >
        {children}
      </Box>
    );
  }
);
