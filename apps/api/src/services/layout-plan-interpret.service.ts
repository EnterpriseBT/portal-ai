import type {
  ColumnDefinitionCatalogEntry,
  LayoutPlan,
  RegionHint,
} from "@portalai/core/contracts";
import { interpret } from "@portalai/spreadsheet-parsing";
import type { Workbook, WorkbookData } from "@portalai/spreadsheet-parsing";

import { DbService } from "./db.service.js";
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
    return interpret({ workbook, regionHints: hints }, deps);
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
