/**
 * Real in-memory Postgres for store tests (PGlite + drizzle's pglite driver)
 * — actual SQL semantics (soft-delete filters, joins, ordering) instead of
 * fluent-chain mock theater. DDL mirrors the CLI's table defs; parity with
 * apps/api is enforced separately by tables-parity.test.ts.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const DDL = `
CREATE TABLE organizations (
  id text PRIMARY KEY,
  created bigint NOT NULL,
  created_by text NOT NULL,
  updated bigint,
  updated_by text,
  deleted bigint,
  deleted_by text,
  name text NOT NULL,
  timezone text NOT NULL,
  owner_user_id text NOT NULL,
  default_station_id text,
  tier text NOT NULL DEFAULT 'standard',
  stripe_customer_id text,
  stripe_subscription_id text
);
CREATE TABLE users (
  id text PRIMARY KEY,
  created bigint NOT NULL,
  created_by text NOT NULL,
  updated bigint,
  updated_by text,
  deleted bigint,
  deleted_by text,
  auth0_id text NOT NULL,
  email text,
  name text,
  picture text,
  last_login bigint
);
CREATE TABLE organization_users (
  id text PRIMARY KEY,
  created bigint NOT NULL,
  created_by text NOT NULL,
  updated bigint,
  updated_by text,
  deleted bigint,
  deleted_by text,
  organization_id text NOT NULL,
  user_id text NOT NULL,
  last_login bigint
);
CREATE TABLE tiers (
  id text PRIMARY KEY,
  created bigint NOT NULL,
  created_by text NOT NULL,
  updated bigint,
  updated_by text,
  deleted bigint,
  deleted_by text,
  slug text NOT NULL
);
`;

export interface TestDb {
  db: PostgresJsDatabase;
  close(): Promise<void>;
}

export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite();
  await client.exec(DDL);
  // The pglite and postgres-js drizzle databases share the same query-builder
  // surface; the store is typed against postgres-js (its runtime driver).
  const db = drizzle(client) as unknown as PostgresJsDatabase;
  return { db, close: () => client.close() };
}

let seq = 0;
export const rowBase = (over: Partial<Record<string, unknown>> = {}) => ({
  id: `row-${++seq}`,
  created: Date.now(),
  createdBy: "test",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...over,
});
