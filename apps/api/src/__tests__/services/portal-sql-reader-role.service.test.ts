/**
 * `PortalSqlReaderRoleService.enterStatements`: the grants a session gives the
 * reader role before switching to it. #644 adds column-level SELECT on a
 * SQL-filtered view's source view, so the reader can read exactly the columns
 * its security_invoker curated view uses.
 */
import { describe, it, expect } from "@jest/globals";

import { PortalSqlReaderRoleService } from "../../services/portal-sql-reader-role.service.js";

describe("PortalSqlReaderRoleService.enterStatements", () => {
  const role = `"${PortalSqlReaderRoleService.roleName()}"`;

  it("grants SELECT on each view once, then switches role", () => {
    expect(
      PortalSqlReaderRoleService.enterStatements([
        "contacts",
        "contacts",
        "deals",
      ])
    ).toEqual([
      `GRANT SELECT ON "contacts" TO ${role}`,
      `GRANT SELECT ON "deals" TO ${role}`,
      `SET LOCAL ROLE ${role}`,
    ]);
  });

  it("grants column-level SELECT on a source view, quoting every identifier (#644)", () => {
    expect(
      PortalSqlReaderRoleService.enterStatements(
        ["parcels"],
        [{ relation: "__src_0", columns: ["entity_record_id", `c_we"ird`] }]
      )
    ).toEqual([
      `GRANT SELECT ON "parcels" TO ${role}`,
      `GRANT SELECT ("entity_record_id", "c_we""ird") ON "__src_0" TO ${role}`,
      `SET LOCAL ROLE ${role}`,
    ]);
  });
});
