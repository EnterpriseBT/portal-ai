import type { IdentityStrategy, Locator, Orientation } from "../plan/index.js";
import type { CellValue, Sheet } from "../workbook/types.js";

export interface IdentityContext {
  sheet: Sheet;
  orientation: Orientation;
  /** 1-based row of the record being emitted. 0 when not applicable. */
  row: number;
  /** 1-based column of the record being emitted. 0 when not applicable. */
  col: number;
}

function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function readLocatorValue(locator: Locator, ctx: IdentityContext): string {
  switch (locator.kind) {
    case "column":
      return cellText(ctx.sheet.cell(ctx.row, locator.col)?.value ?? null);
    case "row":
      return cellText(ctx.sheet.cell(locator.row, ctx.col)?.value ?? null);
    case "cell":
      return cellText(ctx.sheet.cell(locator.row, locator.col)?.value ?? null);
    case "range":
      // Range locators on an identity strategy are ill-formed; fall back to empty.
      return "";
  }
}

/**
 * Derive a stable `source_id` for a record being emitted by `replay()`.
 *
 * The `rowPosition` strategy is orientation-aware: records along the row
 * axis use `row-{n}`, along the column axis use `col-{n}`, and crosstab
 * cells use `cell-{r}-{c}`. These positions are stable as long as the
 * region's bounds don't change; drift detection catches bounds changes
 * before commit.
 */
export function deriveSourceId(
  strategy: IdentityStrategy,
  ctx: IdentityContext
): string {
  switch (strategy.kind) {
    case "column":
      return readLocatorValue(strategy.sourceLocator, ctx);
    case "composite":
      return strategy.sourceLocators
        .map((l) => readLocatorValue(l, ctx))
        .join(strategy.joiner);
    case "rowPosition":
      if (ctx.orientation === "cells-as-records")
        return `cell-${ctx.row}-${ctx.col}`;
      if (ctx.orientation === "columns-as-records") return `col-${ctx.col}`;
      return `row-${ctx.row}`;
  }
}
