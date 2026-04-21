import type {
  ColumnDefinitionCatalogEntry,
  LayoutPlan,
  RegionHint,
  WorkbookData,
} from "@portalai/core/contracts";
import { interpret } from "@portalai/spreadsheet-parsing";

import { DbService } from "./db.service.js";
import {
  createInterpretDeps,
  type CreateInterpretDepsOptions,
} from "./spreadsheet-parsing-llm.service.js";
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
    workbook: WorkbookData,
    hints: RegionHint[],
    orgId: string,
    userId: string,
    depsOverrides?: Omit<CreateInterpretDepsOptions, "columnDefinitionCatalog">
  ): Promise<LayoutPlan> {
    const catalog = await LayoutPlanInterpretService.loadCatalog(orgId);
    const deps = createInterpretDeps({
      ...depsOverrides,
      columnDefinitionCatalog: catalog,
      logger:
        depsOverrides?.logger ??
        createLogger({ module: "interpret", orgId, userId }),
    });
    return interpret({ workbook, regionHints: hints }, deps);
  }

  /**
   * Load the org's `ColumnDefinition` catalog in the shape the parser's
   * classifier expects. Exposed separately so tests can override it via
   * module mocks without stubbing the whole `analyze` pipeline.
   */
  static async loadCatalog(
    orgId: string
  ): Promise<ColumnDefinitionCatalogEntry[]> {
    const rows =
      await DbService.repository.columnDefinitions.findByOrganizationId(orgId);
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      normalizedKey: row.key,
      description: row.description ?? undefined,
      type: row.type,
    }));
  }
}
