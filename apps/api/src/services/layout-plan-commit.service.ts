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
import {
  reconcileFieldMappings,
  resolveNormalizedKey,
} from "./field-mappings/reconcile.js";
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
    // (e.g. SEGMENT_MISSING_AXIS_NAME) must be edited via PATCH
    // before commit. Short-circuits before replay so the workbook isn't
    // even consulted when the plan is known-broken.
    LayoutPlanCommitService.assertNoBlockerWarnings(plan);

    // ── 2b. C1 — each target may appear on at most one region ────────
    LayoutPlanCommitService.assertUniqueEntityTargets(plan);

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
    //    Under C1 each target yields exactly one region; the grouping is
    //    kept for downstream per-entity write coordination (entity upsert,
    //    reconcile, record writes).
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

      // Static field bindings — replay emits these in `record.fields` keyed
      // by `columnDefinitionId`, so the recordFieldKey is the colDefId.
      for (const binding of region.columnBindings as ColumnBinding[]) {
        bucket.push({
          columnDefinitionId: binding.columnDefinitionId,
          sourceField: sourceFieldFromBinding(binding),
          recordFieldKey: binding.columnDefinitionId,
          isPrimaryKey: false,
          excluded: binding.excluded,
          normalizedKey: binding.normalizedKey,
          required: binding.required,
          defaultValue: binding.defaultValue,
          format: binding.format,
          enumValues: binding.enumValues,
          refEntityKey: binding.refEntityKey,
          refNormalizedKey: binding.refNormalizedKey,
        });
      }

      // Pivot segments — replay emits `record.fields[segment.axisName]`,
      // so the recordFieldKey is the human-readable axisName. Each pivot
      // gets its own FieldMapping; the segment's `columnDefinitionId` is
      // populated by `classify-logical-fields` (text-fallback when the
      // classifier doesn't match). `excluded` segments are omitted by the
      // user via the review-step "Omit" toggle and skipped here so no
      // FieldMapping is materialised, parallel to the columnBindings
      // `binding.excluded === true` path.
      for (const axis of ["row", "column"] as const) {
        for (const seg of region.segmentsByAxis?.[axis] ?? []) {
          if (seg.kind !== "pivot" || !seg.columnDefinitionId) continue;
          bucket.push({
            columnDefinitionId: seg.columnDefinitionId,
            sourceField: seg.axisName,
            recordFieldKey: seg.axisName,
            isPrimaryKey: false,
            excluded: seg.excluded,
          });
        }
      }

      // Per-intersection cell-value overrides — when a 2D region carries
      // `intersectionCellValueFields[key]`, replay emits the body cells
      // inside that intersection under the override's `name`. Each entry
      // becomes its own FieldMapping so distinct intersections can carry
      // distinct value types. Done before the region-level cellValueField
      // emission so a downstream identical-name collision is detected by
      // reconcile (LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY) rather than
      // silently winning the second push.
      if (region.intersectionCellValueFields) {
        for (const field of Object.values(region.intersectionCellValueFields)) {
          if (!field?.columnDefinitionId) continue;
          bucket.push({
            columnDefinitionId: field.columnDefinitionId,
            sourceField: field.name,
            recordFieldKey: field.name,
            isPrimaryKey: false,
            excluded: field.excluded,
          });
        }
      }

      // Cell-value field — replay emits `record.fields[cellValueField.name]`
      // for any pivot×pivot body cell that doesn't match an entry in
      // `intersectionCellValueFields`. When every (rowPivot, colPivot)
      // pair has its own override, the region-level cellValueField is
      // never written by replay and would land as an empty FieldMapping
      // here — skip the push in that case so commit doesn't materialise
      // an unused field.
      if (region.cellValueField?.columnDefinitionId) {
        const overrides = region.intersectionCellValueFields ?? {};
        const rowPivotIds: string[] = [];
        const colPivotIds: string[] = [];
        for (const seg of region.segmentsByAxis?.row ?? []) {
          if (seg.kind === "pivot") rowPivotIds.push(seg.id);
        }
        for (const seg of region.segmentsByAxis?.column ?? []) {
          if (seg.kind === "pivot") colPivotIds.push(seg.id);
        }
        let unusedByOverrides = false;
        if (
          region.headerAxes.length === 2 &&
          rowPivotIds.length > 0 &&
          colPivotIds.length > 0
        ) {
          let allCovered = true;
          outer: for (const rid of rowPivotIds) {
            for (const cid of colPivotIds) {
              if (!overrides[`${rid}__${cid}`]) {
                allCovered = false;
                break outer;
              }
            }
          }
          unusedByOverrides = allCovered;
        }
        if (!unusedByOverrides) {
          bucket.push({
            columnDefinitionId: region.cellValueField.columnDefinitionId,
            sourceField: region.cellValueField.name,
            recordFieldKey: region.cellValueField.name,
            isPrimaryKey: false,
            excluded: region.cellValueField.excluded,
          });
        }
      }
    }

    // Precompute per-target normalized-key sets across the whole plan so
    // reference bindings can validate `refNormalizedKey` against staged
    // siblings. Excluded bindings contribute no FieldMapping, so they
    // shouldn't be reachable as ref targets either.
    const stagedEntityKeys = new Set(bindingsByTarget.keys());
    const stagedNormalizedKeysByEntityKey = new Map<string, Set<string>>();
    for (const [targetKey, bucket] of bindingsByTarget.entries()) {
      const keys = new Set<string>();
      for (const binding of bucket) {
        if (binding.excluded === true) continue;
        keys.add(resolveNormalizedKey(binding, catalogById));
      }
      stagedNormalizedKeysByEntityKey.set(targetKey, keys);
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
            stagedEntityKeys,
            stagedNormalizedKeysByEntityKey,
          },
          tx
        );

        // Build the `recordFieldKey → normalizedKey` map the record writer
        // needs so `entity_records.normalizedData` lines up with the
        // `FieldMapping.normalizedKey` values reconcile wrote. Static field
        // bindings expose values under `columnDefinitionId`; pivot +
        // cellValueField bindings expose values under their source name —
        // each binding declares its own `recordFieldKey` so the lookup is
        // uniform. Skip excluded bindings — they have no FieldMapping row.
        const normalizedKeyByRecordFieldKey = new Map<string, string>();
        for (const binding of bindings) {
          if (binding.excluded === true) continue;
          if (!normalizedKeyByRecordFieldKey.has(binding.recordFieldKey)) {
            normalizedKeyByRecordFieldKey.set(
              binding.recordFieldKey,
              resolveNormalizedKey(binding, catalogById)
            );
          }
        }

        const counts = await LayoutPlanCommitService.writeRecords(
          entity.id,
          groupRecords,
          catalogById,
          normalizedKeyByRecordFieldKey,
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

  private static assertUniqueEntityTargets(plan: LayoutPlan): void {
    const seen = new Set<string>();
    for (const region of plan.regions) {
      if (!region.targetEntityDefinitionId) continue;
      if (seen.has(region.targetEntityDefinitionId)) {
        throw new ApiError(
          400,
          ApiCode.LAYOUT_PLAN_DUPLICATE_ENTITY,
          `Plan contains multiple regions targeting entity "${region.targetEntityDefinitionId}". Each entity must be produced by exactly one region.`
        );
      }
      seen.add(region.targetEntityDefinitionId);
    }
  }

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
   * `upsertManyBySourceId`. Translates `ExtractedRecord.fields` (whose keys
   * are either a `columnDefinitionId` for static field segments or a source
   * name like `segment.axisName` / `cellValueField.name` for pivot regions)
   * into `normalizedData` keyed by the binding's resolved `normalizedKey` —
   * the same value reconcile wrote to `FieldMapping.normalizedKey`, so
   * downstream readers can look the record's fields up by the mapping's key.
   * The caller-supplied `normalizedKeyByRecordFieldKey` covers both keying
   * conventions; the catalog-key / raw-field-name fallbacks below remain as
   * safety nets for entries the bindings list didn't cover. Computes
   * created / updated / unchanged by comparing against existing rows by
   * (entity, sourceId, checksum).
   */
  private static async writeRecords(
    connectorEntityId: string,
    records: ExtractedRecord[],
    catalogById: Map<string, ColumnDefinitionSelect>,
    normalizedKeyByRecordFieldKey: Map<string, string>,
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
        // Map the record-field key (columnDefinitionId for statics, source
        // name for pivot/cellValueField) to the same normalizedKey reconcile
        // wrote on the FieldMapping. Catalog-key / raw-field-name remain as
        // last-resort fallbacks for entries no binding covered.
        const key =
          normalizedKeyByRecordFieldKey.get(k) ??
          catalogById.get(k)?.key ??
          k;
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
  /**
   * The key under which this binding's value will appear in
   * `ExtractedRecord.fields`. Replay emits static field-segment values keyed
   * by `columnDefinitionId`, but pivot segment + cellValueField values are
   * keyed by their human-readable name (axisName / cellValueField.name).
   * `writeRecords` consults this key to translate `record.fields` into
   * `normalizedData` keyed by the FieldMapping's normalizedKey.
   */
  recordFieldKey: string;
  isPrimaryKey?: boolean;
  excluded?: boolean;
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  refEntityKey?: string | null;
  refNormalizedKey?: string | null;
}

function sourceFieldFromBinding(binding: ColumnBinding): string {
  if (binding.sourceLocator.kind === "byHeaderName") {
    return binding.sourceLocator.name;
  }
  // byPositionIndex fallback — synthesize a stable label.
  return `${binding.sourceLocator.axis}_${binding.sourceLocator.index}`;
}
