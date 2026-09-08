/**
 * Repository for the `organization_toolpacks` table.
 *
 * Each row is a custom toolpack registered by an organization. The
 * cached `tools` and `metadata` columns are populated by the
 * `ToolpackRegistrationService` at registration and on explicit
 * refresh.
 *
 * `findManyByIds` is used by `tools.service` at session-build time
 * to expand custom rows in `station_toolpacks` into actual
 * `WebhookTool` instances.
 *
 * Two columns are stored as opaque AES-256-GCM ciphertext blobs
 * (see `utils/crypto.util.ts`):
 *   - `auth_headers` — user-supplied auth header map (phase 5).
 *   - `signing_secret` — per-toolpack HMAC signing secret used to
 *     sign every outbound webhook call (phase 6). Stored wrapped
 *     in `{ value: <plaintext> }` so it conforms to
 *     `encryptCredentials`'s `Record<string, unknown>` signature.
 *
 * Every read path decrypts both columns transparently so callers
 * see plaintext (a `Record<string, string> | null` map for auth
 * headers, a `string` for the signing secret); every write path
 * encrypts before insert/update. Repository users never call
 * `encryptCredentials` / `decryptCredentials` directly.
 *
 * The signing-secret migration (0051) inserts a sentinel value for
 * pre-existing rows; the companion `migrate-signing-secrets.ts`
 * script replaces those sentinels with real encrypted secrets. If
 * a sentinel ever reaches `decryptRow` (script not run), the
 * helper throws `TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED` rather
 * than handing the sentinel string out as a "secret."
 */

import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";

import { organizationToolpacks } from "../schema/index.js";
import type {
  OrganizationToolpackSelect,
  OrganizationToolpackInsert,
} from "../schema/zod.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import {
  encryptCredentials,
  decryptCredentials,
} from "../../utils/crypto.util.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "organization-toolpacks-repository" });

// ── Helpers ────────────────────────────────────────────────────────

/** Sentinel value the SQL migration inserts for pre-existing rows. */
const SIGNING_SECRET_SENTINEL = "__pending_phase6_rotation__";

/**
 * A toolpack row plus a marker of whether its signing secret decrypted.
 *
 * `secretDecryptable` is `false` when the row's encrypted `signingSecret`
 * could not be decrypted under the current `ENCRYPTION_KEY` — a *poison
 * row*, e.g. one written under a different key (see #531). Such a row is
 * returned **degraded**: `signingSecret` is `""` and `authHeaders` is
 * `null`, but every other column is intact, so list, name-uniqueness, and
 * seeder-repair paths keep working. On a healthy row the marker is `true`
 * and both columns hold their decrypted plaintext.
 */
export type OrganizationToolpackWithSecretStatus =
  OrganizationToolpackSelect & { secretDecryptable: boolean };

/** Decrypt the `authHeaders` and `signingSecret` columns of a single row. */
function decryptRow<
  T extends { authHeaders: string | null; signingSecret: string },
>(
  row: T
): T & {
  authHeaders: Record<string, string> | null;
  signingSecret: string;
} {
  if (row.signingSecret === SIGNING_SECRET_SENTINEL) {
    throw new Error(
      "TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED: row " +
        `${(row as unknown as { id?: string }).id ?? "<unknown>"} ` +
        "has the migration sentinel — run scripts:migrate-signing-secrets."
    );
  }
  const signingPayload = decryptCredentials(row.signingSecret) as {
    value: string;
  };
  return {
    ...row,
    authHeaders: row.authHeaders
      ? (decryptCredentials(row.authHeaders) as Record<string, string>)
      : null,
    signingSecret: signingPayload.value,
  };
}

/** Decrypt the encrypted columns on an array of rows. */
function decryptRows<
  T extends { authHeaders: string | null; signingSecret: string },
>(
  rows: T[]
): (T & {
  authHeaders: Record<string, string> | null;
  signingSecret: string;
})[] {
  return rows.map(decryptRow);
}

/**
 * Lenient variant of `decryptRow` for the **list** read path.
 *
 * A poison row (encrypted under a different `ENCRYPTION_KEY`, or holding
 * the migration sentinel) must not take down the whole list, so a decrypt
 * failure degrades the single row rather than throwing: the secret and
 * auth headers are omitted and `secretDecryptable: false` flags it. Every
 * other column is preserved so name-uniqueness checks and seeder repair
 * still work. Callers that genuinely need the plaintext secret (outbound
 * signing) use the strict `decryptRow` paths instead. See #531.
 */
function tryDecryptRow<
  T extends { authHeaders: string | null; signingSecret: string },
>(row: T): T & { secretDecryptable: boolean } {
  try {
    return { ...decryptRow(row), secretDecryptable: true };
  } catch (error) {
    logger.warn(
      {
        toolpackId: (row as unknown as { id?: string }).id ?? "<unknown>",
        error: error instanceof Error ? error.message : "Unknown",
      },
      "organization_toolpacks row has an undecryptable signing_secret; " +
        "degrading it in the list rather than failing the request (#531)"
    );
    return {
      ...row,
      authHeaders: null,
      signingSecret: "",
      secretDecryptable: false,
    } as unknown as T & { secretDecryptable: boolean };
  }
}

/**
 * Encrypt plaintext `authHeaders` and `signingSecret` into the format
 * stored in the DB.
 *
 * Both fields accept either the plaintext shape or a string (the
 * pre-encrypted ciphertext) — partial updates that omit a field
 * leave the prior ciphertext untouched. The plaintext shape is
 * `Record<string, string>` for authHeaders and `string` (with the
 * `whsec_` prefix) for signingSecret; both are detected by their
 * runtime type rather than the schema-declared TS type.
 */
function encryptInsert<
  T extends {
    authHeaders?: Record<string, string> | string | null;
    signingSecret?: string;
  },
>(data: T): T {
  let next: T = data;
  if (next.authHeaders != null && typeof next.authHeaders === "object") {
    next = {
      ...next,
      authHeaders: encryptCredentials(
        next.authHeaders as Record<string, unknown>
      ),
    } as T;
  }
  // A signing secret in plaintext starts with "whsec_". A re-supplied
  // ciphertext blob is opaque base64 JSON; we recognise it by the
  // absence of the prefix and pass it through unchanged.
  if (
    typeof next.signingSecret === "string" &&
    next.signingSecret.startsWith("whsec_")
  ) {
    next = {
      ...next,
      signingSecret: encryptCredentials({ value: next.signingSecret }),
    } as T;
  }
  return next;
}

// ── Repository ────────────────────────────────────────────────────

export class OrganizationToolpacksRepository extends Repository<
  typeof organizationToolpacks,
  OrganizationToolpackSelect,
  OrganizationToolpackInsert
> {
  constructor() {
    super(organizationToolpacks);
  }

  // ── Overrides: encrypt on write, decrypt on read ────────────

  override async findById(
    id: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const row = await super.findById(id, client);
    return row ? decryptRow(row) : undefined;
  }

  override async findMany(
    where?: SQL,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    const rows = await super.findMany(where, opts, client);
    return decryptRows(rows);
  }

  override async create(
    data: OrganizationToolpackInsert,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect> {
    const row = await super.create(encryptInsert(data), client);
    return decryptRow(row);
  }

  override async update(
    id: string,
    data: Partial<OrganizationToolpackInsert>,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const row = await super.update(id, encryptInsert(data), client);
    return row ? decryptRow(row) : undefined;
  }

  override async upsert(
    data: OrganizationToolpackInsert,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect> {
    const row = await super.upsert(encryptInsert(data), client);
    return decryptRow(row);
  }

  /**
   * All live (non-soft-deleted) toolpack rows for an organization.
   *
   * This is the **list** read path: it decrypts leniently, so a single
   * poison row (undecryptable signing secret) is returned degraded with
   * `secretDecryptable: false` rather than throwing and 500-ing the whole
   * list. The four callers (toolpacks list, the two name-uniqueness
   * checks, the demo-seeder idempotency lookup) read only `name`/`id`/
   * `tools`/`authHeaders`-presence, never the plaintext secret — so the
   * degradation is invisible to them and lets a re-seed repair the row.
   * Paths that genuinely need the secret use `findByIdScoped` /
   * `findManyByIds`, which stay strict. See #531.
   */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackWithSecretStatus[]> {
    const rows = (await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(
        and(
          eq(organizationToolpacks.organizationId, organizationId),
          isNull(organizationToolpacks.deleted)
        )
      )) as OrganizationToolpackSelect[];
    return rows.map(tryDecryptRow);
  }

  /**
   * Look up multiple toolpacks by id, optionally constrained to an org.
   * Soft-deleted rows are filtered out.
   */
  async findManyByIds(
    ids: string[],
    options: { organizationId?: string } = {},
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    if (ids.length === 0) return [];
    const conditions = [
      inArray(organizationToolpacks.id, ids),
      isNull(organizationToolpacks.deleted),
    ];
    if (options.organizationId) {
      conditions.push(
        eq(organizationToolpacks.organizationId, options.organizationId)
      );
    }
    const rows = (await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(and(...conditions))) as OrganizationToolpackSelect[];
    return decryptRows(rows);
  }

  /**
   * Look up a toolpack by id, optionally constrained to an org.
   * Soft-deleted rows are excluded.
   */
  async findByIdScoped(
    id: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(
        and(
          eq(organizationToolpacks.id, id),
          eq(organizationToolpacks.organizationId, organizationId),
          isNull(organizationToolpacks.deleted)
        )
      )
      .limit(1);
    return row
      ? decryptRow(row as unknown as OrganizationToolpackSelect)
      : undefined;
  }
}

export const organizationToolpacksRepo = new OrganizationToolpacksRepository();
