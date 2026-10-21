import type {
  ColumnDefinitionCatalogEntry,
  LayoutPlan,
  RegionHint,
} from "@portalai/core/contracts";
import { interpret } from "@portalai/spreadsheet-parsing";
import type { Workbook, WorkbookData } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import type { PermissionSet } from "./permission-set.js";
import {
  createInterpretDeps,
  type CreateInterpretDepsOptions,
} from "./spreadsheet-parsing-llm.service.js";
import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

/**
 * Plan-driven workbook interpretation service.
 *
 * Thin adapter around the parser module's `interpret()` — loads the org's
 * `ColumnDefinition` catalog, wires an Anthropic-backed classifier + axis-name
 * recommender behind the parser's DI slots via `createInterpretDeps`, then
 * runs `interpret`. The parser itself never talks to a model.
 */
export class LayoutPlanInterpretService {
  static async analyze(
    workbook: Workbook | WorkbookData,
    hints: RegionHint[],
    orgId: string,
    userId: string,
    permissions: PermissionSet,
    depsOverrides?: Omit<
      CreateInterpretDepsOptions,
      "columnDefinitionCatalog" | "defaultColumnDefinitionId"
    >
  ): Promise<LayoutPlan> {
    const catalog = await LayoutPlanInterpretService.loadCatalog(
      orgId,
      permissions
    );
    // #834: a hint's column definition is the caller's reference, so it must
    // be one they read; unreadable answers like absent.
    const readable = new Set(catalog.map((c) => c.id));
    const unknownHint = hintColumnDefinitionIds(hints).find(
      (id) => !readable.has(id)
    );
    if (unknownHint) {
      throw new ApiError(
        404,
        ApiCode.COLUMN_DEFINITION_NOT_FOUND,
        `Column definition ${unknownHint} not found`
      );
    }
    // Resolve the org's seeded `text` system ColumnDefinition; the parser
    // uses it as the landing spot for any candidate the classifier can't
    // confidently match, so the review step never shows an unbound field.
    const defaultColumnDefinitionId = catalog.find(
      (c) => c.normalizedKey === "text"
    )?.id;
    const deps = createInterpretDeps({
      // Env-selected defaults for each stage. Explicit depsOverrides still
      // win (tests pass a mocked `generateObject` + fixed model ids), so
      // spreading them last preserves that precedence.
      classifierModel: environment.INTERPRET_CLASSIFIER_MODEL,
      axisNameRecommenderModel: environment.INTERPRET_AXIS_NAME_MODEL,
      ...depsOverrides,
      columnDefinitionCatalog: catalog,
      defaultColumnDefinitionId,
      logger:
        depsOverrides?.logger ??
        createLogger({ module: "interpret", orgId, userId }),
    });
    const plan = await interpret({ workbook, regionHints: hints }, deps);
    // #834: the classifier's ids aren't checked against the catalog it was
    // given, so one outside it (a model slip, or steered by cell text) falls
    // back to the default rather than landing in a stored plan.
    return scopePlanToCatalog(plan, readable, defaultColumnDefinitionId);
  }

  /**
   * Load the `ColumnDefinition` catalog in the shape the parser's classifier
   * expects. Exposed separately so tests can override it via module mocks
   * without stubbing the whole `analyze` pipeline. #834: only the definitions
   * the caller can read, since a classified binding becomes a mapping's
   * reference.
   */
  static async loadCatalog(
    orgId: string,
    permissions: PermissionSet
  ): Promise<ColumnDefinitionCatalogEntry[]> {
    const rows =
      await DbService.repository.columnDefinitions.findByOrganizationId(orgId);
    const readable = rows.filter((row) =>
      permissions.can("resource.read", {
        type: "column_definition",
        id: row.id,
        createdBy: row.createdBy,
      })
    );
    return readable.map((row) => ({
      id: row.id,
      label: row.label,
      normalizedKey: row.key,
      description: row.description ?? undefined,
      type: row.type,
    }));
  }
}

/** #834: every column-definition id a set of region hints carries. */
export function hintColumnDefinitionIds(hints: RegionHint[]): string[] {
  const ids: string[] = [];
  for (const hint of hints) {
    for (const axis of ["row", "column"] as const) {
      for (const seg of hint.segmentsByAxis?.[axis] ?? []) {
        const id = (seg as { columnDefinitionId?: string }).columnDefinitionId;
        if (id) ids.push(id);
      }
    }
    if (hint.cellValueField?.columnDefinitionId) {
      ids.push(hint.cellValueField.columnDefinitionId);
    }
    for (const field of Object.values(hint.intersectionCellValueFields ?? {})) {
      if (field?.columnDefinitionId) ids.push(field.columnDefinitionId);
    }
  }
  return ids;
}

/**
 * #834: replace every column-definition id in `plan` that isn't in
 * `readable` with `fallback` (the `text` definition). With no fallback, a
 * binding is excluded and a segment or cell-value field is left unbound, so
 * the review step asks the user to pick one.
 */
export function scopePlanToCatalog(
  plan: LayoutPlan,
  readable: Set<string>,
  fallback: string | undefined
): LayoutPlan {
  const ok = (id: string | null | undefined) => !id || readable.has(id);
  const optionalId = <T extends { columnDefinitionId?: string }>(f: T): T => {
    if (ok(f.columnDefinitionId)) return f;
    const { columnDefinitionId: _dropped, ...rest } = f;
    return (fallback ? { ...rest, columnDefinitionId: fallback } : rest) as T;
  };
  type Segment = NonNullable<
    NonNullable<LayoutPlan["regions"][number]["segmentsByAxis"]>["row"]
  >[number];
  const segment = (seg: Segment): Segment =>
    seg.kind === "pivot" ? optionalId(seg) : seg;
  return {
    ...plan,
    regions: plan.regions.map((region) => ({
      ...region,
      columnBindings: region.columnBindings.map((b) =>
        ok(b.columnDefinitionId)
          ? b
          : fallback
            ? { ...b, columnDefinitionId: fallback }
            : { ...b, columnDefinitionId: null, excluded: true }
      ),
      ...(region.segmentsByAxis
        ? {
            segmentsByAxis: {
              ...(region.segmentsByAxis.row
                ? { row: region.segmentsByAxis.row.map(segment) }
                : {}),
              ...(region.segmentsByAxis.column
                ? { column: region.segmentsByAxis.column.map(segment) }
                : {}),
            },
          }
        : {}),
      ...(region.cellValueField
        ? { cellValueField: optionalId(region.cellValueField) }
        : {}),
      ...(region.intersectionCellValueFields
        ? {
            intersectionCellValueFields: Object.fromEntries(
              Object.entries(region.intersectionCellValueFields).map(
                ([k, f]) => [k, f ? optionalId(f) : f]
              )
            ),
          }
        : {}),
    })),
  } as LayoutPlan;
}
