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
  ConnectorInstanceModelFactory,
  FieldMappingModelFactory,
  OrganizationToolpackModelFactory,
  type ToolpackToolDefinition,
} from "@portalai/core/models";
import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";

import { DbService } from "./db.service.js";
import { importRows } from "./record-import.util.js";
import { wideTableReconcilerService } from "./wide-table-reconciler.service.js";
import { ToolpackRegistrationService } from "./toolpack-registration.service.js";
import { BUILTIN_TOOL_NAMES } from "./tools.service.js";
import { generateSigningSecret } from "../utils/webhook-signing.util.js";
import { readCsvRows } from "../demo/csv-reader.js";
import { readXlsxRows } from "../demo/xlsx-reader.js";
import { readJsonRows } from "../demo/json-reader.js";
import {
  DEMO_ENTITY_SPECS,
  TRANSACTIONS_ENTITY,
  type DemoEntitySpec,
  type DemoInstanceKind,
  type DemoMapping,
} from "../demo/dataset-manifest.js";
import {
  DATASET_SEED,
  generateCustomers,
  generateProducts,
  generateSites,
  synthesizeTransactions,
  transactionRefs,
} from "../demo/demo-data.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "demo-seed" });

/** The system actor all seeded rows are attributed to. */
const SEED_USER = SystemUtilities.id.system;

/** Default transactions row count when `--rows` is not given (CLI overrides). */
const DEFAULT_TRANSACTION_ROWS = 1_000_000;

/**
 * Adapt the sync `synthesizeTransactions` generator to the async string-keyed
 * row shape `importRows` consumes — lazily (one row at a time), so peak memory
 * stays O(batch) even at ~1M rows.
 */
async function* transactionRows(
  rowCount: number
): AsyncGenerator<Record<string, string>> {
  const refs = transactionRefs(
    generateCustomers(DATASET_SEED),
    generateProducts(DATASET_SEED),
    generateSites(DATASET_SEED)
  );
  for (const t of synthesizeTransactions(rowCount, DATASET_SEED, refs)) {
    yield {
      transaction_id: t.transaction_id,
      customer_id: t.customer_id,
      product_id: t.product_id,
      site_id: t.site_id,
      occurred_at: t.occurred_at,
      quantity: String(t.quantity),
      amount: String(t.amount),
      channel: t.channel,
    };
  }
}

/** apps/api/fixtures/demo — the committed fixtures this service reads. */
const FIXTURES_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../fixtures/demo"
);

/** apps/site/public/demo — the REST source (served as a static site asset). */
const SITE_DEMO_DIR = join(
  FIXTURES_DIR,
  "..",
  "..",
  "..",
  "site",
  "public",
  "demo"
);

/** The connector instances the demo populates, keyed by manifest instance kind. */
const INSTANCE_SPECS: Record<
  DemoInstanceKind,
  { slug: string; name: string; config: Record<string, unknown> }
> = {
  sandbox: { slug: "sandbox", name: "Sandbox", config: {} },
  "file-upload-csv": {
    slug: "file-upload",
    name: "File Upload — CSV",
    config: {},
  },
  "file-upload-xlsx": {
    slug: "file-upload",
    name: "File Upload — XLSX",
    config: {},
  },
  "rest-api": {
    slug: "rest-api",
    name: "Demo REST API",
    config: {
      baseUrl: "https://www.portalsai.io/demo",
      auth: { mode: "none" },
    },
  },
};

export interface EntitySeedResult {
  key: string;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

export interface InstanceSeedResult {
  name: string;
  action: "created" | "existing";
}

export interface DemoSeedResult {
  orgId: string;
  rows: number;
  instances: InstanceSeedResult[];
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
    const rowCount = params.rows ?? DEFAULT_TRANSACTION_ROWS;
    logger.info({ orgId, rowCount }, "demo seed starting");

    // Resolve (create if absent) every instance the manifest references, plus
    // Sandbox when the (synthesized) transactions table is being seeded.
    const usedKinds = [...new Set(DEMO_ENTITY_SPECS.map((s) => s.instance))];
    if (rowCount > 0 && !usedKinds.includes("sandbox")) {
      usedKinds.push("sandbox");
    }
    const instanceIds = new Map<DemoInstanceKind, string>();
    const instances: InstanceSeedResult[] = [];
    for (const kind of usedKinds) {
      const resolved = await DemoSeedService.resolveOrCreateInstance(
        orgId,
        kind
      );
      instanceIds.set(kind, resolved.id);
      instances.push({
        name: INSTANCE_SPECS[kind].name,
        action: resolved.action,
      });
    }

    const entities: EntitySeedResult[] = [];
    for (const spec of DEMO_ENTITY_SPECS) {
      entities.push(
        await DemoSeedService.provisionAndImport(
          orgId,
          instanceIds.get(spec.instance)!,
          spec,
          DemoSeedService.rowsFor(spec)
        )
      );
    }

    // Large-volume transactions — synthesized (not a file), streamed lazily
    // into importRows. `rows: 0` skips it; the CLI passes an env-appropriate
    // count (≈1M app-dev/prod, smaller locally).
    if (rowCount > 0) {
      entities.push(
        await DemoSeedService.provisionAndImport(
          orgId,
          instanceIds.get("sandbox")!,
          TRANSACTIONS_ENTITY,
          transactionRows(rowCount)
        )
      );
    }

    const toolpacks = await DemoSeedService.seedToolpacks(orgId);

    return {
      orgId,
      rows: rowCount,
      instances,
      entities,
      toolpacks,
      googleSheets: { present: false },
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Enable all eight built-in toolpacks plus the demo custom webhook toolpack
   * (#510) on the org's station. The custom pack is registered from the
   * configured `DEMO_TOOLPACK_URL`; if that is unset or unreachable it is
   * skipped (built-ins still enable) so seeding never fails on the toolpack.
   */
  private static async seedToolpacks(
    orgId: string
  ): Promise<{ builtins: string[]; custom: string | null }> {
    const builtinSlugs = BUILTIN_TOOLPACKS.map((p) => p.slug);

    const [station] =
      await DbService.repository.stations.findByOrganizationId(orgId);
    if (!station) {
      throw new Error(
        `demo seed: org ${orgId} has no station — provision the org first`
      );
    }

    let custom: string | null = null;
    const baseUrl = process.env.DEMO_TOOLPACK_URL;
    if (baseUrl) {
      try {
        custom = await DemoSeedService.registerCustomToolpack(orgId, baseUrl);
      } catch (err) {
        logger.warn(
          { orgId, baseUrl, err: (err as Error).message },
          "custom toolpack registration failed — enabling built-ins only"
        );
      }
    }

    await DbService.repository.stationToolpacks.replaceForStation(
      station.id,
      {
        builtinSlugs,
        organizationToolpackIds: custom ? [custom] : [],
      },
      { userId: SEED_USER }
    );

    return { builtins: builtinSlugs, custom };
  }

  /** Register the demo custom webhook toolpack (mirrors POST /api/toolpacks). */
  private static async registerCustomToolpack(
    orgId: string,
    baseUrl: string
  ): Promise<string> {
    const endpoints = {
      schema: `${baseUrl}/schema`,
      runtime: `${baseUrl}/runtime`,
      metadata: `${baseUrl}/metadata`,
    };
    const signingSecret = generateSigningSecret();
    const tools = await ToolpackRegistrationService.fetchSchema(
      endpoints.schema,
      undefined,
      signingSecret
    );
    ToolpackRegistrationService.validateNoBuiltinCollision(
      tools as ToolpackToolDefinition[],
      BUILTIN_TOOL_NAMES
    );
    const metadata = await ToolpackRegistrationService.fetchMetadata(
      endpoints.metadata,
      undefined,
      signingSecret
    );
    const now = Date.now();
    const model = new OrganizationToolpackModelFactory().create(SEED_USER);
    model.update({
      organizationId: orgId,
      name: "demo_supply_tools",
      description: "Harborview Supply Co. vendor tools (shipping + credit).",
      endpoints,
      authHeaders: null,
      signingSecret,
      tools,
      metadata,
      schemaFetchedAt: now,
      metadataFetchedAt: metadata !== null ? now : null,
    });
    const row = await DbService.repository.organizationToolpacks.create(
      model.parse() as never
    );
    return row.id;
  }

  /**
   * Resolve the connector instance for a manifest kind, creating it if absent.
   * "Sandbox" already exists (auto-provisioned); File Upload / REST instances
   * are created here so the connector view shows the right connector types.
   */
  private static async resolveOrCreateInstance(
    orgId: string,
    kind: DemoInstanceKind
  ): Promise<{ id: string; action: "created" | "existing" }> {
    const { slug, name, config } = INSTANCE_SPECS[kind];
    const def =
      await DbService.repository.connectorDefinitions.findBySlug(slug);
    if (!def) {
      throw new Error(
        `demo seed: '${slug}' connector definition not found — seed connector definitions first`
      );
    }
    const existing =
      await DbService.repository.connectorInstances.findByOrgDefinitionAndName(
        orgId,
        def.id,
        name
      );
    if (existing) return { id: existing.id, action: "existing" };

    if (kind === "sandbox") {
      throw new Error(
        `demo seed: org ${orgId} has no Sandbox instance — provision the org first`
      );
    }

    const model = new ConnectorInstanceModelFactory().create(SEED_USER).update({
      connectorDefinitionId: def.id,
      organizationId: orgId,
      name,
      status: "active",
      config,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { ...def.capabilityFlags },
    });
    const created = await DbService.repository.connectorInstances.create(
      model.parse()
    );
    return { id: created.id, action: "created" };
  }

  /**
   * Provision one entity (entity → mappings → reconcile) then dual-write the
   * given lazy row source through the app's real import path. Shared by the
   * file-backed base entities and the synthesized `transactions` table.
   */
  private static async provisionAndImport(
    orgId: string,
    connectorInstanceId: string,
    def: { key: string; label: string; mappings: DemoMapping[] },
    rows: AsyncIterable<Record<string, string>>
  ): Promise<EntitySeedResult> {
    // 1. Connector entity (idempotent by key).
    const entityModel = new ConnectorEntityModelFactory().create(SEED_USER);
    entityModel.update({
      organizationId: orgId,
      connectorInstanceId,
      key: def.key,
      label: def.label,
    });
    const entity = await DbService.repository.connectorEntities.upsertByKey(
      entityModel.parse()
    );
    await wideTableReconcilerService.ensureTable(entity.id);

    // 2. Field mappings (idempotent by (entity, normalizedKey)).
    for (const m of def.mappings) {
      const column = await DbService.repository.columnDefinitions.findByKey(
        orgId,
        m.columnKey
      );
      if (!column) {
        throw new Error(
          `demo seed: system column definition '${m.columnKey}' missing for org ${orgId} (entity ${def.key}.${m.sourceField})`
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
    const result = await importRows(rows, {
      connectorEntityId: entity.id,
      organizationId: orgId,
      userId: SEED_USER,
    });
    logger.info({ orgId, entity: def.key, ...result }, "entity seeded");
    return { key: def.key, ...result };
  }

  /** The lazy row source for an entity, by fixture format. */
  private static rowsFor(
    spec: DemoEntitySpec
  ): AsyncIterable<Record<string, string>> {
    switch (spec.format) {
      case "csv":
        return readCsvRows(join(FIXTURES_DIR, spec.file));
      case "xlsx":
        return readXlsxRows(join(FIXTURES_DIR, spec.file), spec.sheet);
      case "json":
        // The REST source lives under the marketing site (served as an asset).
        return readJsonRows(join(SITE_DEMO_DIR, spec.file));
    }
  }
}
