/**
 * DemoSeedService (#509) — populates a demo org from the committed dataset
 * (#508) through the app's real import path, in-process.
 *
 * For each entity: ensure a connector entity under the org's Sandbox instance,
 * resolve + upsert field mappings against the seeded system column definitions,
 * reconcile the wide table, then dual-write records via `importRows` (streaming,
 * O(batch) memory). Idempotent: `importRows` keys on a positional source_id and
 * the fixtures/synth yield rows in a stable order, so a re-seed converges to
 * all-`unchanged`.
 *
 * Spawned by the `db:demo:seed` script, which the `portalai demo seed` CLI runs
 * via `runApiScript` (#509 transport decision). No BullMQ jobs, no HTTP.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  ConnectorEntityModelFactory,
  FieldMappingModelFactory,
} from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { importRows } from "./record-import.util.js";
import { wideTableReconcilerService } from "./wide-table-reconciler.service.js";
import { readCsvRows } from "../demo/csv-reader.js";
import {
  DEMO_ENTITY_SPECS,
  type DemoEntitySpec,
} from "../demo/dataset-manifest.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "demo-seed" });

/** The system actor all seeded rows are attributed to. */
const SEED_USER = SystemUtilities.id.system;

/** apps/api/fixtures/demo — the committed fixtures this service reads. */
const FIXTURES_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../fixtures/demo"
);

export interface EntitySeedResult {
  key: string;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

export interface DemoSeedResult {
  orgId: string;
  rows: number;
  entities: EntitySeedResult[];
  toolpacks: { builtins: string[]; custom: string | null };
  googleSheets: { present: boolean };
  durationMs: number;
}

export class DemoSeedService {
  static async seed(params: {
    orgId: string;
    rows?: number;
  }): Promise<DemoSeedResult> {
    const startedAt = Date.now();
    const { orgId } = params;
    logger.info({ orgId }, "demo seed starting");

    const sandboxInstanceId =
      await DemoSeedService.resolveSandboxInstanceId(orgId);

    const entities: EntitySeedResult[] = [];
    for (const spec of DEMO_ENTITY_SPECS) {
      // Slice 3 introduces dedicated File Upload instances; for now every
      // entity rides the Sandbox instance.
      entities.push(
        await DemoSeedService.seedEntity(orgId, sandboxInstanceId, spec)
      );
    }

    return {
      orgId,
      rows: 0,
      entities,
      toolpacks: { builtins: [], custom: null },
      googleSheets: { present: false },
      durationMs: Date.now() - startedAt,
    };
  }

  /** Resolve the org's auto-provisioned "Sandbox" connector instance id. */
  private static async resolveSandboxInstanceId(
    orgId: string
  ): Promise<string> {
    const def =
      await DbService.repository.connectorDefinitions.findBySlug("sandbox");
    if (!def) {
      throw new Error(
        "demo seed: 'sandbox' connector definition not found — seed connector definitions first"
      );
    }
    const instance =
      await DbService.repository.connectorInstances.findByOrgDefinitionAndName(
        orgId,
        def.id,
        "Sandbox"
      );
    if (!instance) {
      throw new Error(
        `demo seed: org ${orgId} has no Sandbox instance — provision the org first`
      );
    }
    return instance.id;
  }

  /** Provision one entity (entity → mappings → reconcile) then import its rows. */
  private static async seedEntity(
    orgId: string,
    connectorInstanceId: string,
    spec: DemoEntitySpec
  ): Promise<EntitySeedResult> {
    // 1. Connector entity (idempotent by key).
    const entityModel = new ConnectorEntityModelFactory().create(SEED_USER);
    entityModel.update({
      organizationId: orgId,
      connectorInstanceId,
      key: spec.key,
      label: spec.label,
    });
    const entity = await DbService.repository.connectorEntities.upsertByKey(
      entityModel.parse()
    );
    await wideTableReconcilerService.ensureTable(entity.id);

    // 2. Field mappings (idempotent by (entity, normalizedKey)).
    for (const m of spec.mappings) {
      const column = await DbService.repository.columnDefinitions.findByKey(
        orgId,
        m.columnKey
      );
      if (!column) {
        throw new Error(
          `demo seed: system column definition '${m.columnKey}' missing for org ${orgId} (entity ${spec.key}.${m.sourceField})`
        );
      }
      const mappingModel = new FieldMappingModelFactory().create(SEED_USER);
      mappingModel.update({
        organizationId: orgId,
        connectorEntityId: entity.id,
        columnDefinitionId: column.id,
        sourceField: m.sourceField,
        isPrimaryKey: m.isPrimaryKey ?? false,
        normalizedKey: m.normalizedKey ?? m.sourceField,
        required: m.required ?? false,
        defaultValue: null,
        format: null,
        enumValues: null,
        refNormalizedKey: m.refColumnKey ?? null,
        refEntityKey: m.refEntityKey ?? null,
      });
      await DbService.repository.fieldMappings.upsertByEntityAndNormalizedKey(
        mappingModel.parse()
      );
    }

    // 3. Build the wide table columns from the mappings.
    await wideTableReconcilerService.reconcileEntity(entity.id);

    // 4. Dual-write the records through the app's real import path.
    const rows = DemoSeedService.rowsFor(spec);
    const result = await importRows(rows, {
      connectorEntityId: entity.id,
      organizationId: orgId,
      userId: SEED_USER,
    });
    logger.info({ orgId, entity: spec.key, ...result }, "entity seeded");
    return { key: spec.key, ...result };
  }

  /** The lazy row source for an entity (slice 3 adds xlsx). */
  private static rowsFor(
    spec: DemoEntitySpec
  ): AsyncIterable<Record<string, string>> {
    if (spec.format === "csv") {
      return readCsvRows(join(FIXTURES_DIR, spec.file));
    }
    throw new Error(`demo seed: unsupported fixture format '${spec.format}'`);
  }
}
