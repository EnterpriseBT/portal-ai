/**
 * Commit a layout plan: run `replay(plan, workbook)`, gate on drift, then
 * materialize `ConnectorEntity` / `FieldMapping` / `entity_records` rows.
 *
 * Records come from the parser module's `@portalai/spreadsheet-parsing/replay`
 * output, then bulk-write through `entityRecords.upsertManyBySourceId`.
 *
 * TODO(sync-history): No `sync_history` table exists today. When one lands,
 * insert a row here with `layout_plan_id: planId` so each commit run is
 * auditable.
 */

import { and, eq, inArray } from "drizzle-orm";

import type {
  ColumnBinding,
  DriftReport,
  ExtractedRecord,
  LayoutPlan,
  LayoutPlanCommitResult,
  Region,
  WorkbookData,
} from "@portalai/core/contracts";
import { WorkbookSchema } from "@portalai/core/contracts";
import { computeChecksum, replay } from "@portalai/spreadsheet-parsing/replay";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { reconcileFieldMappings } from "./field-mappings/reconcile.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import { db } from "../db/client.js";
import {
  connectorInstances,
  entityRecords,
  fieldMappings,
} from "../db/schema/index.js";
import type {
  ColumnDefinitionSelect,
  EntityRecordInsert,
  EntityRecordSelect,
} from "../db/schema/zod.js";
import type { DbClient } from "../db/repositories/base.repository.js";

export class LayoutPlanCommitService {
  static async commit(
    connectorInstanceId: string,
    planId: string,
    organizationId: string,
    userId: string,
    body: { workbook: unknown }
  ): Promise<LayoutPlanCommitResult> {
    // ── 1. Verify ownership + load plan row ────────────────────────────
    await LayoutPlanCommitService.ensureInstanceInOrg(
      connectorInstanceId,
      organizationId
    );

    const planRow =
      await DbService.repository.connectorInstanceLayoutPlans.findById(planId);
    if (!planRow || planRow.connectorInstanceId !== connectorInstanceId) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        "Layout plan not found for this connector instance"
      );
    }
    const plan = planRow.plan as LayoutPlan;
    const logger = createLogger({
      module: "layout-plan-commit",
      connectorInstanceId,
      planId,
      layoutPlanVersion: plan.planVersion,
      organizationId,
    });
    logger.info({ event: "commit.started" }, "layout plan commit started");

    // ── 2a. Blocker-warnings gate ─────────────────────────────────────
    // Regions the interpreter flagged with blocker-severity warnings
    // (e.g. PIVOTED_REGION_MISSING_AXIS_NAME) must be edited via PATCH
    // before commit. Short-circuits before replay so the workbook isn't
    // even consulted when the plan is known-broken.
    LayoutPlanCommitService.assertNoBlockerWarnings(plan);

    // ── 2. Validate + run replay ──────────────────────────────────────
    const wb = LayoutPlanCommitService.validateWorkbook(body.workbook);

    let records: ExtractedRecord[];
    let drift: DriftReport;
    try {
      const result = replay(plan, wb);
      records = result.records;
      drift = result.drift;
    } catch (err) {
      throw new ApiError(
        500,
        ApiCode.LAYOUT_PLAN_COMMIT_FAILED,
        err instanceof Error ? err.message : "Replay failed"
      );
    }

    // ── 3. Drift gating ───────────────────────────────────────────────
    LayoutPlanCommitService.assertDriftAllowsCommit(drift);

    // ── 4. Load ColumnDefinition catalog for normalizedKey resolution ──
    const catalogRows =
      await DbService.repository.columnDefinitions.findByOrganizationId(
        organizationId
      );
    const catalogById = new Map(
      (catalogRows as ColumnDefinitionSelect[]).map((r) => [r.id, r])
    );

    // ── 5. Group records + bindings by targetEntityDefinitionId ────────
    const recordsByTarget = new Map<string, ExtractedRecord[]>();
    for (const record of records) {
      const bucket =
        recordsByTarget.get(record.targetEntityDefinitionId) ??
        (recordsByTarget
          .set(record.targetEntityDefinitionId, [])
          .get(record.targetEntityDefinitionId) as ExtractedRecord[]);
      bucket.push(record);
    }

    const bindingsByTarget = new Map<string, PlanBindingWithSource[]>();
    for (const region of plan.regions as Region[]) {
      const bucket =
        bindingsByTarget.get(region.targetEntityDefinitionId) ??
        (bindingsByTarget
          .set(region.targetEntityDefinitionId, [])
          .get(region.targetEntityDefinitionId) as PlanBindingWithSource[]);
      for (const binding of region.columnBindings as ColumnBinding[]) {
        bucket.push({
          columnDefinitionId: binding.columnDefinitionId,
          sourceField: sourceFieldFromBinding(binding),
          isPrimaryKey: false,
        });
      }
    }

    // ── 6. Per-target: upsert entity, reconcile mappings, write records ─
    const connectorEntityIds: string[] = [];
    const totals: LayoutPlanCommitResult["recordCounts"] = {
      created: 0,
      updated: 0,
      unchanged: 0,
      invalid: 0,
    };

    for (const [targetId, groupRecords] of recordsByTarget.entries()) {
      const bindings = bindingsByTarget.get(targetId) ?? [];
      await DbService.transaction(async (tx) => {
        const entity = await DbService.repository.connectorEntities.upsertByKey(
          {
            id: SystemUtilities.id.v4.generate(),
            organizationId,
            connectorInstanceId,
            key: targetId,
            label: targetId,
            created: Date.now(),
            createdBy: userId,
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
          tx
        );
        connectorEntityIds.push(entity.id);

        await reconcileFieldMappings(
          {
            connectorEntityId: entity.id,
            organizationId,
            userId,
            bindings,
            catalogById,
          },
          tx
        );

        const counts = await LayoutPlanCommitService.writeRecords(
          entity.id,
          groupRecords,
          catalogById,
          organizationId,
          userId,
          tx
        );
        totals.created += counts.created;
        totals.updated += counts.updated;
        totals.unchanged += counts.unchanged;
        totals.invalid += counts.invalid;
      });
    }

    logger.info(
      {
        event: "commit.completed",
        connectorEntityCount: connectorEntityIds.length,
        recordCounts: totals,
      },
      "layout plan commit completed"
    );

    return { connectorEntityIds, recordCounts: totals };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private static assertNoBlockerWarnings(plan: LayoutPlan): void {
    const blockerWarnings: Array<{
      regionId: string;
      code: string;
      message: string;
    }> = [];
    for (const region of plan.regions) {
      for (const warning of region.warnings) {
        if (warning.severity === "blocker") {
          blockerWarnings.push({
            regionId: region.id,
            code: warning.code,
            message: warning.message,
          });
        }
      }
    }
    if (blockerWarnings.length > 0) {
      const codes = Array.from(new Set(blockerWarnings.map((w) => w.code)));
      throw new ApiError(
        409,
        ApiCode.LAYOUT_PLAN_BLOCKER_WARNINGS,
        `Plan carries ${blockerWarnings.length} blocker warning(s); commit halted.`,
        { warnings: blockerWarnings, codes }
      );
    }
  }

  private static assertDriftAllowsCommit(drift: DriftReport): void {
    if (drift.identityChanging) {
      throw new ApiError(
        409,
        ApiCode.LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED,
        "Drift would change the source_id derivation — user confirmation required before commit.",
        { drift }
      );
    }
    if (drift.severity === "blocker") {
      throw new ApiError(
        409,
        ApiCode.LAYOUT_PLAN_DRIFT_BLOCKER,
        "Blocker-level drift detected — commit halted.",
        { drift }
      );
    }
    if (drift.severity === "warn") {
      throw new ApiError(
        409,
        ApiCode.LAYOUT_PLAN_DRIFT_HALT,
        "Drift at 'warn' severity — region drift knobs require halt.",
        { drift }
      );
    }
  }

  private static validateWorkbook(raw: unknown): WorkbookData {
    const parsed = WorkbookSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
        "Invalid workbook payload",
        { issues: parsed.error.issues }
      );
    }
    return parsed.data as WorkbookData;
  }

  private static async ensureInstanceInOrg(
    connectorInstanceId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<void> {
    const [row] = await (client as typeof db)
      .select({ id: connectorInstances.id })
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.id, connectorInstanceId),
          eq(connectorInstances.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!row) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance not found for this organization"
      );
    }
  }

  /**
   * Write one group's records into `entity_records` via
   * `upsertManyBySourceId`. Translates `ExtractedRecord.fields` (keyed by
   * columnDefinitionId or axis-name) into `normalizedData` (keyed by
   * catalog `key` where resolvable, otherwise key falls through). Computes
   * created / updated / unchanged by comparing against existing rows by
   * (entity, sourceId, checksum).
   */
  private static async writeRecords(
    connectorEntityId: string,
    records: ExtractedRecord[],
    catalogById: Map<string, ColumnDefinitionSelect>,
    organizationId: string,
    userId: string,
    tx: DbClient
  ): Promise<LayoutPlanCommitResult["recordCounts"]> {
    if (records.length === 0) {
      return { created: 0, updated: 0, unchanged: 0, invalid: 0 };
    }

    // Dedup records by sourceId within the group — two regions that contribute
    // the same source_id to the same entity (common when regions merge) must
    // collapse into one row. Merge fields last-writer-wins; re-compute the
    // checksum over the merged fields so upsert change detection stays honest.
    const mergedBySourceId = new Map<string, ExtractedRecord>();
    for (const record of records) {
      const prev = mergedBySourceId.get(record.sourceId);
      if (!prev) {
        mergedBySourceId.set(record.sourceId, record);
        continue;
      }
      const mergedFields = { ...prev.fields, ...record.fields };
      mergedBySourceId.set(record.sourceId, {
        ...record,
        fields: mergedFields,
        checksum: computeChecksum(mergedFields),
      });
    }
    const dedupedRecords = Array.from(mergedBySourceId.values());

    const sourceIds = dedupedRecords.map((r) => r.sourceId);
    const existingRows = (await (tx as typeof db)
      .select()
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.connectorEntityId, connectorEntityId),
          inArray(entityRecords.sourceId, sourceIds)
        )
      )) as EntityRecordSelect[];
    const existingBySourceId = new Map(
      existingRows.map((r) => [r.sourceId, r])
    );

    const toUpsert: EntityRecordInsert[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const now = Date.now();

    for (const record of dedupedRecords) {
      const prev = existingBySourceId.get(record.sourceId);
      if (prev && prev.checksum === record.checksum && prev.deleted === null) {
        unchanged++;
        continue;
      }

      const normalizedData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record.fields)) {
        const col = catalogById.get(k);
        const key = col?.key ?? k;
        normalizedData[key] = v;
      }

      toUpsert.push({
        id: prev?.id ?? SystemUtilities.id.v4.generate(),
        organizationId,
        connectorEntityId,
        data: record.fields,
        normalizedData,
        sourceId: record.sourceId,
        checksum: record.checksum,
        syncedAt: now,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: prev?.created ?? now,
        createdBy: prev?.createdBy ?? userId,
        updated: prev ? now : null,
        updatedBy: prev ? userId : null,
        deleted: null,
        deletedBy: null,
      });
      if (prev) updated++;
      else created++;
    }

    if (toUpsert.length > 0) {
      await DbService.repository.entityRecords.upsertManyBySourceId(
        toUpsert,
        tx
      );
    }

    // `fieldMappings` is imported above only to satisfy the type-check that
    // the soft-delete cascade tests reference this subtree consistently —
    // actual mapping writes happen in reconcileFieldMappings.
    void fieldMappings;

    return { created, updated, unchanged, invalid: 0 };
  }
}

interface PlanBindingWithSource {
  columnDefinitionId: string;
  sourceField: string;
  isPrimaryKey?: boolean;
}

function sourceFieldFromBinding(binding: ColumnBinding): string {
  if (binding.sourceLocator.kind === "byHeaderName") {
    return binding.sourceLocator.name;
  }
  // byColumnIndex fallback — synthesize a stable label.
  return `col_${binding.sourceLocator.col}`;
}
