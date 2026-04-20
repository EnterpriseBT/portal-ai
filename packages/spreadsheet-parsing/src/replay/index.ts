import {
  LayoutPlanSchema,
  type LayoutPlan,
  type Region,
  type ReplayResult,
} from "../plan/index.js";
import { makeWorkbook } from "../workbook/helpers.js";
import type { Workbook, WorkbookData } from "../workbook/types.js";
import { computeChecksum } from "./checksum.js";
import { detectRegionDrift, rollUpDrift } from "./drift.js";
import { extractRecords } from "./extract-records.js";

export { computeChecksum } from "./checksum.js";

/**
 * Deterministic replay of a `LayoutPlan` against a `Workbook`. Pure function
 * of `(plan, workbook)` — no network, no logging, no model call.
 *
 * Consumers get:
 *   - `records`: `ExtractedRecord[]` across every region in plan order.
 *   - `drift`: aggregated `DriftReport` — severity + identityChanging flags
 *     that the commit pipeline uses to halt on identity-affecting changes.
 *
 * Accepts either a `WorkbookData` (serialisable) or an already-adapted
 * `Workbook` (with `sheet.cell()` accessors). The schema guard only runs
 * against the plan; workbook shape is accepted as-is.
 */
export function replay(
  plan: LayoutPlan,
  workbook: Workbook | WorkbookData
): ReplayResult {
  const validatedPlan = LayoutPlanSchema.parse(plan);
  const wb: Workbook =
    "sheets" in workbook &&
    workbook.sheets.length > 0 &&
    "cell" in workbook.sheets[0]
      ? (workbook as Workbook)
      : makeWorkbook(workbook as WorkbookData);

  const sheetByName = new Map(wb.sheets.map((s) => [s.name, s]));
  const records: ReplayResult["records"] = [];
  const regionDrifts: ReplayResult["drift"]["regionDrifts"] = [];

  for (const region of validatedPlan.regions as Region[]) {
    const sheet = sheetByName.get(region.sheet);
    if (!sheet) continue;
    records.push(...extractRecords(region, sheet));
    regionDrifts.push(detectRegionDrift(region, sheet));
  }

  const drift = rollUpDrift(regionDrifts);
  // Prevent unused-import warnings when downstream consumers import the
  // `computeChecksum` re-export only for its type (rare but possible).
  void computeChecksum;
  return { records, drift };
}
