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

  // Column-based identity only makes sense when records iterate rows —
  // i.e., 1D with a row header. For 2D crosstabs each body cell is a
  // record (not each row), so a unique-column candidate would assign
  // the same sourceId to every (rowPivot × colPivot) record sharing
  // that row, collapsing the K × L matrix to K records under upsert.
  // Crosstabs fall through to `rowPosition` (cell-coord sourceId) so
  // every pivot×pivot record gets a distinct id. For records-are-columns
  // or headerless-column, column identity is also skipped.
  const recAxis = recordsAxisOf(region);
  const admitsColumnIdentity =
    recAxis === "row" && region.headerAxes.length !== 2;

  const rowHeader = headerCandidates?.find((c) => c.axis === "row");
  const headerRow = rowHeader?.index ?? bounds.startRow - 1;

  const out: IdentityCandidate[] = [];

  if (admitsColumnIdentity) {
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
