import {
  recordsAxisOf,
  type IdentityStrategy,
  type Region,
} from "../../plan/index.js";
import type { Sheet } from "../../workbook/index.js";
import type {
  HeaderCandidate,
  IdentityCandidate,
  InterpretState,
} from "../types.js";

function cellText(sheet: Sheet, row: number, col: number): string {
  const c = sheet.cell(row, col);
  if (!c || c.value === null) return "";
  if (c.value instanceof Date) return c.value.toISOString();
  if (typeof c.value === "boolean") return c.value ? "true" : "false";
  return String(c.value);
}

function collectDataValuesInColumn(
  sheet: Sheet,
  col: number,
  headerRow: number,
  endRow: number
): string[] {
  const out: string[] = [];
  for (let r = headerRow + 1; r <= endRow; r++) {
    out.push(cellText(sheet, r, col));
  }
  return out;
}

function collectDataValuesInRow(
  sheet: Sheet,
  row: number,
  headerCol: number,
  endCol: number
): string[] {
  const out: string[] = [];
  for (let c = headerCol + 1; c <= endCol; c++) {
    out.push(cellText(sheet, row, c));
  }
  return out;
}

function isUnique(values: string[]): boolean {
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length < 2) return false;
  return new Set(nonEmpty).size === nonEmpty.length;
}

function candidatesForRegion(
  region: Region,
  sheet: Sheet,
  headerCandidates: HeaderCandidate[] | undefined
): IdentityCandidate[] {
  const { bounds, sheet: sheetName } = region;

  // Single-locator identity is admitted on 1D regions only — records iterate
  // along one axis, so the perpendicular axis carries one cell per record
  // and we can scan it for uniqueness. 2D crosstabs treat each body cell
  // as a record, so any axis-locator candidate would collapse the K × L
  // matrix to K (or L) records under upsert; they fall through to
  // `rowPosition` (cell-coord sourceId) so every body cell stays distinct.
  const recAxis = recordsAxisOf(region);

  const out: IdentityCandidate[] = [];

  if (recAxis === "row") {
    // Records-are-rows: scan columns for uniqueness; identity locator
    // points at a column.
    const rowHeader = headerCandidates?.find((c) => c.axis === "row");
    const headerRow = rowHeader?.index ?? bounds.startRow - 1;

    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const values = collectDataValuesInColumn(
        sheet,
        c,
        headerRow,
        bounds.endRow
      );
      if (isUnique(values)) {
        const nonEmptyRatio =
          values.filter((v) => v !== "").length / Math.max(1, values.length);
        const strategy: IdentityStrategy = {
          kind: "column",
          sourceLocator: { kind: "column", sheet: sheetName, col: c },
          confidence: 0.6 + 0.4 * nonEmptyRatio,
        };
        out.push({
          strategy,
          score: strategy.confidence,
          rationale: `Column ${c} has unique, non-empty values for every record.`,
        });
      }
    }

    // Composite candidate — first 2 columns that together are unique.
    if (out.length === 0 && bounds.endCol - bounds.startCol >= 1) {
      for (let c1 = bounds.startCol; c1 < bounds.endCol; c1++) {
        for (let c2 = c1 + 1; c2 <= bounds.endCol; c2++) {
          const v1 = collectDataValuesInColumn(
            sheet,
            c1,
            headerRow,
            bounds.endRow
          );
          const v2 = collectDataValuesInColumn(
            sheet,
            c2,
            headerRow,
            bounds.endRow
          );
          const pairs = v1.map((v, i) => `${v}||${v2[i] ?? ""}`);
          if (isUnique(pairs)) {
            out.push({
              strategy: {
                kind: "composite",
                sourceLocators: [
                  { kind: "column", sheet: sheetName, col: c1 },
                  { kind: "column", sheet: sheetName, col: c2 },
                ],
                joiner: "|",
                confidence: 0.55,
              },
              score: 0.55,
              rationale: `Columns ${c1}+${c2} together produce unique row keys.`,
            });
            break;
          }
        }
        if (out.length > 0) break;
      }
    }
  } else if (recAxis === "column") {
    // Records-are-columns: scan rows for uniqueness; identity locator
    // points at a row.
    const colHeader = headerCandidates?.find((c) => c.axis === "column");
    const headerCol = colHeader?.index ?? bounds.startCol - 1;

    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      const values = collectDataValuesInRow(
        sheet,
        r,
        headerCol,
        bounds.endCol
      );
      if (isUnique(values)) {
        const nonEmptyRatio =
          values.filter((v) => v !== "").length / Math.max(1, values.length);
        const strategy: IdentityStrategy = {
          kind: "column",
          sourceLocator: { kind: "row", sheet: sheetName, row: r },
          confidence: 0.6 + 0.4 * nonEmptyRatio,
        };
        out.push({
          strategy,
          score: strategy.confidence,
          rationale: `Row ${r} has unique, non-empty values for every record.`,
        });
      }
    }

    // Composite candidate — first 2 rows that together are unique.
    if (out.length === 0 && bounds.endRow - bounds.startRow >= 1) {
      for (let r1 = bounds.startRow; r1 < bounds.endRow; r1++) {
        for (let r2 = r1 + 1; r2 <= bounds.endRow; r2++) {
          const v1 = collectDataValuesInRow(
            sheet,
            r1,
            headerCol,
            bounds.endCol
          );
          const v2 = collectDataValuesInRow(
            sheet,
            r2,
            headerCol,
            bounds.endCol
          );
          const pairs = v1.map((v, i) => `${v}||${v2[i] ?? ""}`);
          if (isUnique(pairs)) {
            out.push({
              strategy: {
                kind: "composite",
                sourceLocators: [
                  { kind: "row", sheet: sheetName, row: r1 },
                  { kind: "row", sheet: sheetName, row: r2 },
                ],
                joiner: "|",
                confidence: 0.55,
              },
              score: 0.55,
              rationale: `Rows ${r1}+${r2} together produce unique column keys.`,
            });
            break;
          }
        }
        if (out.length > 0) break;
      }
    }
  }

  out.push({
    strategy: { kind: "rowPosition", confidence: 0.3 },
    score: 0.3,
    rationale:
      "Fallback to row position (warns because row reorder breaks ids).",
  });

  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Stage 3 — populate `identityCandidates` per region. Prefers single unique
 * column > composite 2-column key > rowPosition fallback. `rowPosition`
 * warning emission happens in `score-and-warn`.
 */
export function detectIdentity(state: InterpretState): InterpretState {
  const next = new Map(state.identityCandidates);
  for (const region of state.detectedRegions) {
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) {
      next.set(region.id, [
        {
          strategy: { kind: "rowPosition", confidence: 0 },
          score: 0,
          rationale: "Sheet not found",
        },
      ]);
      continue;
    }
    next.set(
      region.id,
      candidatesForRegion(region, sheet, state.headerCandidates.get(region.id))
    );
  }
  return { ...state, identityCandidates: next };
}
