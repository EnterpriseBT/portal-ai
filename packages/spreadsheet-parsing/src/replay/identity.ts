import type { IdentityStrategy, Locator } from "../plan/index.js";
import type { CellValue, Sheet } from "../workbook/types.js";

export interface IdentityContext {
  sheet: Sheet;
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
      return "";
  }
}

/**
 * Derive a stable `source_id` for a record being emitted by `replay()`.
 *
 * `rowPosition` derives from which coords are populated:
 * - both row and col → `cell-{r}-{c}` (2D crosstab)
 * - col only       → `col-{c}` (columns-as-records)
 * - row only       → `row-{r}` (rows-as-records)
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
      if (ctx.row > 0 && ctx.col > 0) return `cell-${ctx.row}-${ctx.col}`;
      if (ctx.col > 0) return `col-${ctx.col}`;
      return `row-${ctx.row}`;
  }
}
