/**
 * `db:seed:org` — idempotent-by-name org fixture (#190, the portalai CLI's
 * `seed org` spawn target). Owner is a synthetic placeholder unless
 * `--owner-email` names an existing real user; `--admin-email` / `--member-email`
 * add existing real users with those roles (#620 multi-role e2e), so the org is
 * enterable as owner/admin/member. Every named user must already exist (have
 * logged in once) — this links rows, it does not mint logins.
 *
 * `--all-toolpacks` enables **every** built-in toolpack on the org's station(s)
 * (#629), instead of the minimal `data_query`-only default a new station gets.
 * The e2e/smoke fixture opts into this so an agent-guided smoke walk can exercise
 * any pack's features (rbac_management, entity_management, gis, …), not just
 * data_query. It is a fixture concern — production org provisioning keeps its
 * minimal default untouched.
 *
 * Usage: tsx src/db/seed-org.ts --name <name> [--owner-email <e>]
 *          [--admin-email <e>] [--member-email <e>] [--tier <slug>]
 *          [--all-toolpacks]
 */
import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";

import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { closeDatabase } from "./client.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Enable every built-in pack on each of the org's stations (fixtures only).
 *  Idempotent — `replaceForStation` reconciles, so re-seeding is a no-op. */
async function enableAllToolpacks(organizationId: string): Promise<void> {
  const builtinSlugs = BUILTIN_TOOLPACKS.map((p) => p.slug);
  const stations =
    await DbService.repository.stations.findByOrganizationId(organizationId);
  for (const station of stations) {
    await DbService.repository.stationToolpacks.replaceForStation(
      station.id,
      { builtinSlugs },
      { userId: SystemUtilities.id.system }
    );
  }
}

async function main() {
  const name = arg("--name");
  if (!name) {
    throw new Error(
      "Usage: db:seed:org -- --name <name> [--member-email <email>] [--all-toolpacks]"
    );
  }
  const result = await ApplicationService.seedOrganization({
    name,
    ownerEmail: arg("--owner-email"),
    adminEmail: arg("--admin-email"),
    memberEmail: arg("--member-email"),
    tier: arg("--tier"),
  });
  if (hasFlag("--all-toolpacks")) {
    await enableAllToolpacks(result.organizationId);
  }
  console.log(JSON.stringify(result));
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
