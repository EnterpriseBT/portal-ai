/**
 * The schema-parity pin (#190, confirmed test-only exception).
 *
 * The CLI owns minimal drizzle table defs (runtime imports of apps/api are
 * forbidden — module-load side effects + inverted package graph). This test
 * imports the API's REAL table modules (pure: drizzle + core only) and
 * asserts the CLI's defs are a faithful SUBSET: same table name, and every
 * CLI column exists in the API's with matching db name, dataType and
 * notNull. A migration that changes a shared column turns this red in CI.
 */

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import * as cli from "../tables.js";

// Test-only relative imports of the API schema (pure modules).
import { organizations as apiOrganizations } from "../../../../apps/api/src/db/schema/organizations.table.js";
import { users as apiUsers } from "../../../../apps/api/src/db/schema/users.table.js";
import { organizationUsers as apiOrganizationUsers } from "../../../../apps/api/src/db/schema/organization-users.table.js";
import { tiers as apiTiers } from "../../../../apps/api/src/db/schema/tiers.table.js";

function assertSubset(cliTable: PgTable, apiTable: PgTable): void {
  const c = getTableConfig(cliTable);
  const a = getTableConfig(apiTable);
  expect(c.name).toBe(a.name);
  const apiCols = new Map(a.columns.map((col) => [col.name, col]));
  for (const col of c.columns) {
    const apiCol = apiCols.get(col.name);
    expect(apiCol).toBeDefined();
    expect({ name: col.name, dataType: col.dataType, notNull: col.notNull }).toEqual({
      name: apiCol!.name,
      dataType: apiCol!.dataType,
      notNull: apiCol!.notNull,
    });
  }
}

describe("CLI table defs subset-match apps/api's schema", () => {
  it("organizations", () => assertSubset(cli.organizations, apiOrganizations));
  it("users", () => assertSubset(cli.users, apiUsers));
  it("organization_users", () =>
    assertSubset(cli.organizationUsers, apiOrganizationUsers));
  it("tiers (existence-check subset)", () => assertSubset(cli.tiers, apiTiers));
});
