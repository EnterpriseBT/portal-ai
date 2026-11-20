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
 * Spawned by the `db:demo:create` script, which the `portalai demo create` CLI
 * runs via `runApiScript` (#509 transport decision) against an org it has just
 * provisioned (#1035). The caller passes the station to seed onto; the service
 * never looks one up, since an org holds several. No BullMQ jobs, no HTTP.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  ConnectorEntityModelFactory,
  ConnectorInstanceModelFactory,
  CuratedViewModelFactory,
  FieldMappingModelFactory,
  OrganizationToolpackModelFactory,
  StationViewModelFactory,
  type ToolpackToolDefinition,
} from "@portalai/core/models";
import {
  generateSigningSecret,
  SigningSecretSchema,
} from "@portalai/core/contracts";
import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";

import { DbService } from "./db.service.js";
import { importRows } from "./record-import.util.js";
import { wideTableReconcilerService } from "./wide-table-reconciler.service.js";
import { ToolpackRegistrationService } from "./toolpack-registration.service.js";
import { BUILTIN_TOOL_NAMES } from "./tools.service.js";
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

/** The demo custom toolpack's name — unique per org, so a re-seed refreshes the
 *  existing row rather than inserting a duplicate (see registerCustomToolpack). */
const DEMO_TOOLPACK_NAME = "demo_supply_tools";

/** How many rows the seed loads between checks that its org is still live. */
const ORG_LIVENESS_CHECK_EVERY = 5_000;
/** …and at most this long, since writes into a deleted org slow down. */
const ORG_LIVENESS_CHECK_EVERY_MS = 2_000;

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
  connectorEntityId: string;
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
  stationId: string;
  rows: number;
  instances: InstanceSeedResult[];
  entities: EntitySeedResult[];
  toolpacks: { builtins: string[]; custom: string | null };
  /** Curated views attached to the demo station, one per entity (#1035). */
  views: number;
  googleSheets: { present: boolean };
  durationMs: number;
}

export class DemoSeedService {
  static async seed(params: {
    orgId: string;
    /** The station the demo connectors and packs land on (#1035). */
    stationId: string;
    /** Synthesized `transactions` rows; 0 skips the table. */
    rows: number;
  }): Promise<DemoSeedResult> {
    const startedAt = Date.now();
    const { orgId, stationId } = params;
    const rowCount = params.rows;
    logger.info({ orgId, stationId, rowCount }, "demo seed starting");

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

    // Link every resolved instance to the demo station (station_instances) so
    // its entities are queryable in a portal. Connector-instance creation does
    // NOT auto-link — only an explicit "add to station" does (station.router) —
    // so without this a freshly-seeded org exposes only the auto-provisioned
    // Sandbox (transactions), and every entity-specific prompt (customers,
    // sites, orders) and the map find no data.
    await DemoSeedService.ensureStationLinks(stationId, [
      ...instanceIds.values(),
    ]);

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
    // into importRows. `rows: 0` skips it; the CLI defaults it to 10,000.
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

    // Since #674 a station reaches entity data only through attached curated
    // views, so without these the demo's portal has nothing to query.
    const views = await DemoSeedService.seedStationViews(
      orgId,
      stationId,
      entities
    );

    const toolpacks = await DemoSeedService.seedToolpacks(orgId, stationId);

    return {
      orgId,
      stationId,
      rows: rowCount,
      instances,
      entities,
      toolpacks,
      views,
      googleSheets: { present: false },
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Pass `rows` through, checking that the org is still live every `every`
   * rows **or** every `everyMs` of wall time, whichever comes first, and
   * throw once it isn't (#1035 adversarial review). A `demo delete` that
   * races a running `demo create` otherwise leaves the load writing into a
   * deleted org until it runs out of memory. Writes into a deleted org also
   * get slow, which is why time is a trigger as well as rows: the stop lands
   * within about one import batch. The check is one indexed lookup.
   */
  static async *stopWhenOrgDeleted<T>(
    orgId: string,
    rows: AsyncIterable<T>,
    every = ORG_LIVENESS_CHECK_EVERY,
    everyMs = ORG_LIVENESS_CHECK_EVERY_MS
  ): AsyncGenerator<T> {
    let sinceCheck = 0;
    let lastCheck = Date.now();
    for await (const row of rows) {
      if (sinceCheck >= every || Date.now() - lastCheck >= everyMs) {
        sinceCheck = 0;
        lastCheck = Date.now();
        if (!(await DbService.repository.organizations.findById(orgId))) {
          throw new Error(`demo org ${orgId} was deleted during the load`);
        }
      }
      sinceCheck++;
      yield row;
    }
  }

  /**
   * One unrestricted curated view per seeded entity (keyed like the entity:
   * every column, every row), attached to the demo station (#1035). Since
   * #674 attached views are a station's only data surface, so the presenter
   * script's queries need them. An unrestricted view depends on no field
   * mapping or filter key, so it needs none of the view-dependency locking a
   * projected or filtered view does. Idempotent: an existing view with the
   * key is reused, and the attachment ignores a live duplicate.
   */
  private static async seedStationViews(
    orgId: string,
    stationId: string,
    entities: EntitySeedResult[]
  ): Promise<number> {
    const viewIds: string[] = [];
    for (const entity of entities) {
      const existing = await DbService.repository.curatedViews.findByKey(
        orgId,
        entity.key
      );
      if (existing) {
        viewIds.push(existing.id);
        continue;
      }
      const label =
        DEMO_ENTITY_SPECS.find((s) => s.key === entity.key)?.label ??
        TRANSACTIONS_ENTITY.label;
      const view = await DbService.repository.curatedViews.create(
        new CuratedViewModelFactory()
          .create(SEED_USER)
          .update({
            organizationId: orgId,
            connectorEntityId: entity.connectorEntityId,
            key: entity.key,
            label,
            description: `Every ${label.toLowerCase()} record in the demo dataset.`,
            filter: null,
            filterSql: null,
            filterSqlKeys: [],
            sourcePortalId: null,
          })
          .parse() as never
      );
      viewIds.push(view.id);
    }
    await DbService.repository.stationViews.insertManyIgnoreConflicts(
      viewIds.map((curatedViewId) =>
        new StationViewModelFactory()
          .create(SEED_USER)
          .update({ organizationId: orgId, stationId, curatedViewId })
          .parse()
      ) as never
    );
    return viewIds.length;
  }

  /**
   * Enable every built-in toolpack (Help included, #1050) plus the demo custom webhook toolpack
   * (#510) on the demo station. The custom pack is registered from the
   * configured `DEMO_TOOLPACK_URL`. A failed registration (#911: a refused
   * signature, an unreachable endpoint) **fails the seed** (#1035): every demo
   * ships with its toolpack, and the create script soft-deletes the org on
   * failure. With no URL set (local only; `portalai demo create` requires it
   * on deployed envs) the seed enables built-ins only.
   */
  private static async seedToolpacks(
    orgId: string,
    stationId: string
  ): Promise<{ builtins: string[]; custom: string | null }> {
    const builtinSlugs = BUILTIN_TOOLPACKS.map((p) => p.slug);

    let custom: string | null = null;
    const baseUrl = process.env.DEMO_TOOLPACK_URL;
    if (baseUrl) {
      try {
        custom = await DemoSeedService.registerCustomToolpack(orgId, baseUrl);
      } catch (err) {
        throw new Error(
          `demo toolpack registration failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }
    } else {
      logger.info(
        { orgId },
        "DEMO_TOOLPACK_URL is not set — enabling built-in toolpacks only"
      );
    }

    await DbService.repository.stationToolpacks.replaceForStation(
      stationId,
      {
        builtinSlugs,
        organizationToolpackIds: custom ? [custom] : [],
      },
      { userId: SEED_USER }
    );

    return { builtins: builtinSlugs, custom };
  }

  /** The org's demo custom toolpack row, if it was registered before. */
  private static async findDemoToolpack(orgId: string) {
    return (
      await DbService.repository.organizationToolpacks.findByOrganizationId(
        orgId
      )
    ).find((t) => t.name === DEMO_TOOLPACK_NAME);
  }

  /**
   * The demo toolpack's signing secret (#911), in order:
   *   1. the first entry of `DEMO_TOOLPACK_SIGNING_SECRETS` (this env's entry
   *      in the demo Lambda's allow-list), so the Lambda can verify the
   *      registration fetches;
   *   2. the secret the existing registration already holds, so a re-seed
   *      run without the variable keeps it rather than replacing it;
   *   3. a freshly minted one.
   * A malformed configured value warns once, naming the variable but never
   * its value, and falls through.
   */
  private static demoSigningSecret(existingSecret: string | undefined): string {
    const configured = (process.env.DEMO_TOOLPACK_SIGNING_SECRETS ?? "")
      .split(",")
      .map((s) => s.trim())
      .find(Boolean);
    if (configured) {
      if (SigningSecretSchema.safeParse(configured).success) return configured;
      logger.warn(
        "DEMO_TOOLPACK_SIGNING_SECRETS' first entry is not a whsec_ signing secret; ignoring it"
      );
    }
    // An undecryptable row reads back with an empty secret (#531).
    if (
      existingSecret &&
      SigningSecretSchema.safeParse(existingSecret).success
    ) {
      return existingSecret;
    }
    return generateSigningSecret();
  }

  /**
   * Register (or refresh) the demo custom webhook toolpack — mirrors
   * POST /api/toolpacks, but **idempotent**: the demo seeder is a re-runnable
   * convergence (#509; since #1035 every run targets a fresh org, but the
   * guarantee stays cheap and keeps a retried seed safe), and
   * `(organization_id, name)` is unique. A plain INSERT on re-run 23505s, and —
   * worse — leaves `seedToolpacks` to fall through to `replaceForStation` with
   * an empty id list, which *disassociates* the already-registered toolpack
   * from the station. So refresh an existing row in place and reuse its id.
   */
  private static async registerCustomToolpack(
    orgId: string,
    baseUrl: string
  ): Promise<string> {
    const endpoints = {
      schema: `${baseUrl}/schema`,
      runtime: `${baseUrl}/runtime`,
      metadata: `${baseUrl}/metadata`,
    };
    const existing = await DemoSeedService.findDemoToolpack(orgId);
    const signingSecret = DemoSeedService.demoSigningSecret(
      existing?.signingSecret
    );
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
    const fields = {
      organizationId: orgId,
      name: DEMO_TOOLPACK_NAME,
      description: "Harborview Supply Co. vendor tools (shipping + credit).",
      endpoints,
      authHeaders: null,
      signingSecret,
      tools,
      metadata,
      schemaFetchedAt: now,
      metadataFetchedAt: metadata !== null ? now : null,
    };

    if (existing) {
      await DbService.repository.organizationToolpacks.update(
        existing.id,
        fields as never
      );
      return existing.id;
    }

    const model = new OrganizationToolpackModelFactory().create(SEED_USER);
    model.update(fields);
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
  /**
   * Ensure each connector instance is linked to the demo station via
   * `station_instances` — idempotent, so a re-seed is a no-op. Provisioning
   * attaches Sandbox to Playground only (#848), so every instance the demo
   * uses, Sandbox included, is linked here or its entities never appear in a
   * portal on the demo station.
   */
  private static async ensureStationLinks(
    stationId: string,
    connectorInstanceIds: string[]
  ): Promise<void> {
    const existing =
      await DbService.repository.stationInstances.findByStationId(stationId);
    const linked = new Set(existing.map((s) => s.connectorInstanceId));
    const now = Date.now();
    for (const connectorInstanceId of connectorInstanceIds) {
      if (linked.has(connectorInstanceId)) continue;
      await DbService.repository.stationInstances.create({
        id: SystemUtilities.id.v4.generate(),
        stationId,
        connectorInstanceId,
        created: now,
        createdBy: SEED_USER,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
    }
  }

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

    // 4. Dual-write the records through the app's real import path. The
    // stream stops if the org is deleted mid-load (a racing `demo delete`).
    const result = await importRows(
      DemoSeedService.stopWhenOrgDeleted(orgId, rows),
      {
        connectorEntityId: entity.id,
        organizationId: orgId,
        userId: SEED_USER,
      }
    );
    logger.info({ orgId, entity: def.key, ...result }, "entity seeded");
    return { key: def.key, connectorEntityId: entity.id, ...result };
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
