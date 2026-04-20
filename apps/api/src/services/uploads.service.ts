/**
 * Legacy simple-layout upload path. New flows should use
 * `POST /api/connector-instances/:id/layout-plan/interpret` +
 * `POST /api/connector-instances/:id/layout-plan/:planId/commit`
 * per `docs/SPREADSHEET_PARSING.backend.spec.md`.
 *
 * This service is scheduled for retirement per
 * `docs/FILE_UPLOAD_DEPRECATION.plan.md`.
 *
 * ---
 *
 * Uploads Service — handles confirmation of file upload recommendations.
 *
 * Orchestrates the creation of connector instances, entities, and field
 * mappings in a single database transaction. Column definitions are
 * referenced by ID — they must already exist (seeded or user-created).
 */

import type {
  ConfirmRequestBody,
  ConfirmResponsePayload,
  ConfirmResponseEntity,
} from "@portalai/core/contracts";
import type { FileUploadMetadata } from "@portalai/core/models";

import path from "node:path";

import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { JobEventsService } from "./job-events.service.js";
import { CsvImportService } from "./csv-import.service.js";
import { XlsxImportService } from "./xlsx-import.service.js";
import type { DbTransaction } from "../db/repositories/base.repository.js";
import { SystemUtilities } from "../utils/system.util.js";

const logger = createLogger({ module: "uploads-service" });

const CONFIRM_TIMEOUT_MS = 30_000;

/**
 * Split an XLSX-style `sourceFileName` into the workbook name and sheet name.
 *
 * Examples:
 *   "data.xlsx[Contacts]"  → { baseName: "data.xlsx", sheetName: "Contacts" }
 *   "data.xlsx[Deal Hist]" → { baseName: "data.xlsx", sheetName: "Deal Hist" }
 *   "contacts.csv"         → { baseName: "contacts.csv", sheetName: null }
 *
 * Used at confirm time to (a) match the bracketed `sourceFileName` from the
 * recommendation back to the unbracketed S3 metadata entry, and (b) decide
 * whether to route the import through the XLSX or CSV service.
 */
export function extractSheetName(sourceFileName: string): {
  baseName: string;
  sheetName: string | null;
} {
  const match = sourceFileName.match(/^(.+?)\[([^\]]+)\]$/);
  if (match) return { baseName: match[1], sheetName: match[2] };
  return { baseName: sourceFileName, sheetName: null };
}

export class UploadsService {
  /**
   * Confirm file upload recommendations and persist all entities.
   *
   * Runs inside a single database transaction:
   * 1. Upsert connector instance
   * 2. For each entity: upsert connector entity
   * 3. For each column: validate existing column definition
   * 4. For each mapping: upsert field mapping
   * 5. Transition job to completed
   * 6. Emit job:complete SSE event
   */
  static async confirm(
    jobId: string,
    organizationId: string,
    userId: string,
    body: ConfirmRequestBody
  ): Promise<ConfirmResponsePayload> {
    // Fetch and validate job
    const job = await DbService.repository.jobs.findById(jobId);
    if (!job) {
      throw new ApiError(404, ApiCode.JOB_NOT_FOUND, "Job not found");
    }

    if (job.organizationId !== organizationId) {
      throw new ApiError(
        403,
        ApiCode.JOB_UNAUTHORIZED,
        "Job belongs to a different organization"
      );
    }

    if (job.status !== "awaiting_confirmation") {
      throw new ApiError(
        409,
        ApiCode.UPLOAD_INVALID_STATE,
        `Job is not awaiting confirmation (current status: ${job.status})`
      );
    }

    // Validate all column definition references up front
    for (const entity of body.entities) {
      for (const col of entity.columns) {
        const existing = await DbService.repository.columnDefinitions.findById(
          col.existingColumnDefinitionId
        );
        if (!existing || existing.organizationId !== organizationId) {
          throw new ApiError(
            400,
            ApiCode.UPLOAD_INVALID_REFERENCE,
            `Column definition "${col.existingColumnDefinitionId}" not found or does not belong to this organization`
          );
        }
      }
    }

    const metadata = job.metadata as unknown as FileUploadMetadata;
    const now = SystemUtilities.utc.now().getTime();

    // Run entire confirmation in a transaction with timeout
    const result = await Promise.race([
      DbService.transaction(async (tx) => {
        return UploadsService.confirmInTransaction(
          tx,
          organizationId,
          userId,
          metadata,
          body,
          now
        );
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new ApiError(
                504,
                ApiCode.UPLOAD_CONFIRM_TIMEOUT,
                "Confirmation timed out"
              )
            ),
          CONFIRM_TIMEOUT_MS
        )
      ),
    ]);

    // Import records for each confirmed entity, routing CSV vs XLSX by extension
    for (const confirmedEntity of result.confirmedEntities) {
      // Find the matching request entity to get sourceFileName
      const requestEntity = body.entities.find(
        (e) => e.entityKey === confirmedEntity.entityKey
      );
      if (!requestEntity) continue;

      // XLSX uploads carry "<workbook>.xlsx[<Sheet>]" in sourceFileName; the
      // S3 metadata only knows the workbook name, so unwrap before matching.
      const { baseName, sheetName } = extractSheetName(
        requestEntity.sourceFileName
      );
      const s3File = metadata.files.find((f) => f.originalName === baseName);
      if (!s3File) {
        logger.warn(
          {
            entityKey: confirmedEntity.entityKey,
            sourceFileName: requestEntity.sourceFileName,
          },
          "No S3 file found for entity — skipping import"
        );
        continue;
      }

      try {
        const extension = path.extname(s3File.originalName).toLowerCase();
        const importResult =
          extension === ".xlsx"
            ? await XlsxImportService.importFromS3({
                s3Key: s3File.s3Key,
                sheetName: sheetName ?? "",
                connectorEntityId: confirmedEntity.connectorEntityId,
                organizationId,
                userId,
              })
            : await CsvImportService.importFromS3({
                s3Key: s3File.s3Key,
                connectorEntityId: confirmedEntity.connectorEntityId,
                organizationId,
                userId,
              });
        (confirmedEntity as ConfirmResponseEntity).importResult = importResult;
      } catch (err) {
        logger.error(
          {
            error: err instanceof Error ? err.message : "Unknown error",
            entityKey: confirmedEntity.entityKey,
          },
          "Failed to import records for entity"
        );
        // Set empty import result so the confirm still succeeds
        (confirmedEntity as ConfirmResponseEntity).importResult = {
          created: 0,
          updated: 0,
          unchanged: 0,
          invalid: 0,
        };
      }
    }

    // Transition job to completed and emit SSE event
    const confirmedEntityIds = result.confirmedEntities.map(
      (e) => e.connectorEntityId
    );
    await JobEventsService.transition(jobId, "completed", {
      progress: 100,
      result: {
        ...((job.result as Record<string, unknown>) ?? {}),
        confirmedEntities: confirmedEntityIds,
      },
    });

    await JobEventsService.publishCustomEvent(jobId, "complete", {
      confirmedEntities: confirmedEntityIds,
    });

    logger.info(
      { jobId, entityCount: result.confirmedEntities.length },
      "Upload confirmed with records imported"
    );

    return result;
  }

  private static async confirmInTransaction(
    tx: DbTransaction,
    organizationId: string,
    userId: string,
    metadata: FileUploadMetadata,
    body: ConfirmRequestBody,
    now: number
  ): Promise<ConfirmResponsePayload> {
    // 1. Upsert connector instance
    const existingInstance =
      await DbService.repository.connectorInstances.findByOrgDefinitionAndName(
        organizationId,
        metadata.connectorDefinitionId,
        body.connectorInstanceName,
        tx
      );

    let connectorInstance;
    if (existingInstance) {
      connectorInstance = await DbService.repository.connectorInstances.update(
        existingInstance.id,
        {
          updated: now,
          updatedBy: userId,
        },
        tx
      );
      connectorInstance = connectorInstance!;
    } else {
      const definition =
        await DbService.repository.connectorDefinitions.findById(
          metadata.connectorDefinitionId,
          tx
        );
      const defFlags = definition?.capabilityFlags;

      connectorInstance = await DbService.repository.connectorInstances.create(
        {
          id: SystemUtilities.id.v4.generate(),
          connectorDefinitionId: metadata.connectorDefinitionId,
          organizationId,
          name: body.connectorInstanceName,
          status: "active",
          config: {},
          credentials: null,
          lastSyncAt: null,
          lastErrorMessage: null,
          enabledCapabilityFlags: defFlags
            ? {
                sync: defFlags.sync ?? false,
                read: true,
                write: defFlags.write ?? false,
                push: defFlags.push ?? false,
              }
            : { sync: false, read: true, write: false, push: false },
          created: now,
          createdBy: userId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        tx
      );
    }

    // 2. Process each entity
    const confirmedEntities: ConfirmResponseEntity[] = [];

    for (const entity of body.entities) {
      // Upsert connector entity
      const connectorEntity =
        await DbService.repository.connectorEntities.upsertByKey(
          {
            id: SystemUtilities.id.v4.generate(),
            organizationId,
            connectorInstanceId: connectorInstance.id,
            key: entity.entityKey,
            label: entity.entityLabel,
            created: now,
            createdBy: userId,
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
          tx
        );

      const entityColumnDefs: { id: string; key: string; label: string }[] = [];
      const entityFieldMappings: {
        id: string;
        sourceField: string;
        columnDefinitionId: string;
        isPrimaryKey: boolean;
        normalizedKey: string;
      }[] = [];

      // Soft-delete existing field mappings for this entity whose normalized
      // key is not in the incoming set.  This prevents unique-constraint
      // violations on (connector_entity_id, normalized_key) when a re-confirm
      // reassigns a normalized key to a different column definition.
      const incomingNormalizedKeys = new Set(
        entity.columns.map((c) => c.normalizedKey)
      );
      const existingMappings =
        await DbService.repository.fieldMappings.findByConnectorEntityId(
          connectorEntity.id,
          tx
        );
      const staleIds = existingMappings
        .filter((fm) => !incomingNormalizedKeys.has(fm.normalizedKey))
        .map((fm) => fm.id);
      if (staleIds.length > 0) {
        await DbService.repository.fieldMappings.softDeleteMany(
          staleIds,
          userId,
          tx
        );
      }

      for (const col of entity.columns) {
        // Look up the existing column definition (already validated above)
        const colDef = await DbService.repository.columnDefinitions.findById(
          col.existingColumnDefinitionId,
          tx
        );
        entityColumnDefs.push({
          id: colDef!.id,
          key: colDef!.key,
          label: colDef!.label,
        });

        // Reference resolution is field-mapping-level: the incoming column
        // carries refEntityKey / refNormalizedKey when the mapping points to
        // another entity's normalized key, regardless of the column definition type.
        const hasRefFields =
          !!col.refNormalizedKey ||
          colDef!.type === "reference" ||
          colDef!.type === "reference-array";

        // Upsert field mapping
        const fieldMapping =
          await DbService.repository.fieldMappings.upsertByEntityAndNormalizedKey(
            {
              id: SystemUtilities.id.v4.generate(),
              organizationId,
              connectorEntityId: connectorEntity.id,
              columnDefinitionId: colDef!.id,
              sourceField: col.sourceField,
              isPrimaryKey: col.isPrimaryKey,
              normalizedKey: col.normalizedKey,
              required: col.required,
              defaultValue: col.defaultValue ?? null,
              format: col.format,
              enumValues: col.enumValues ?? null,
              refNormalizedKey: col.refNormalizedKey ?? null,
              refEntityKey: hasRefFields ? (col.refEntityKey ?? null) : null,
              created: now,
              createdBy: userId,
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
            },
            tx
          );

        entityFieldMappings.push({
          id: fieldMapping.id,
          sourceField: fieldMapping.sourceField,
          columnDefinitionId: fieldMapping.columnDefinitionId,
          isPrimaryKey: fieldMapping.isPrimaryKey,
          normalizedKey: fieldMapping.normalizedKey,
        });
      }

      confirmedEntities.push({
        connectorEntityId: connectorEntity.id,
        entityKey: connectorEntity.key,
        entityLabel: connectorEntity.label,
        columnDefinitions: entityColumnDefs,
        fieldMappings: entityFieldMappings,
      });
    }

    return {
      connectorInstanceId: connectorInstance.id,
      connectorInstanceName: connectorInstance.name,
      confirmedEntities,
    };
  }
}
