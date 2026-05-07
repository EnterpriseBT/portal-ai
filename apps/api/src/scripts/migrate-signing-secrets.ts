#!/usr/bin/env node
/**
 * Phase-6 one-shot migration: replace every `__pending_phase6_rotation__`
 * sentinel value in `organization_toolpacks.signing_secret` with a
 * freshly-generated, encrypted real signing secret.
 *
 * Idempotent — re-running is a no-op for already-real rows.
 * Required after `db:migrate` for migration 0051; the SQL migration
 * inserts the sentinel because PostgreSQL can't call the Node-side
 * `encryptCredentials` to encrypt a real secret in-place.
 *
 * Run from the apps/api directory:
 *
 *   cd apps/api && npm run scripts:migrate-signing-secrets
 *
 * The script connects via `DATABASE_URL`, finds rows with the
 * sentinel, generates a fresh `whsec_*` secret per row, encrypts it
 * with `encryptCredentials`, and writes back. Prints a count of
 * rows updated and rows already-real (skipped). Exits 0 on success.
 *
 * The encrypted value is stored as a JSON string wrapping the
 * secret in `{ value: <plaintext> }` so it conforms to
 * `encryptCredentials`'s `Record<string, unknown>` signature without
 * changing crypto.util. The repository's decrypt path unwraps it.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import * as schema from "../db/schema/index.js";
import { encryptCredentials } from "../utils/crypto.util.js";
import { generateSigningSecret } from "../utils/webhook-signing.util.js";

const SENTINEL = "__pending_phase6_rotation__";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error(
      "ENCRYPTION_KEY is not set — cannot encrypt generated signing secrets"
    );
    process.exit(1);
  }

  const connection = postgres(databaseUrl, { max: 1 });
  const db = drizzle(connection, { schema });

  try {
    const pendingRows = await db
      .select({
        id: schema.organizationToolpacks.id,
        signingSecret: schema.organizationToolpacks.signingSecret,
      })
      .from(schema.organizationToolpacks)
      .where(eq(schema.organizationToolpacks.signingSecret, SENTINEL));

    console.log(
      `Found ${pendingRows.length} row(s) with the sentinel; encrypting fresh secrets…`
    );

    let updated = 0;
    for (const row of pendingRows) {
      const plaintext = generateSigningSecret();
      const ciphertext = encryptCredentials({ value: plaintext });
      await db
        .update(schema.organizationToolpacks)
        .set({ signingSecret: ciphertext })
        .where(eq(schema.organizationToolpacks.id, row.id));
      updated += 1;
    }

    console.log(`Updated ${updated} row(s).`);
    console.log("Done.");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
