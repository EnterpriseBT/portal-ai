/**
 * `db:seed:org` — idempotent-by-name org fixture (#190, the portalai CLI's
 * `seed org` spawn target). Owner is a synthetic placeholder unless
 * `--owner-email` names an existing real user; `--admin-email` / `--member-email`
 * add existing real users with those roles (#620 multi-role e2e), so the org is
 * enterable as owner/admin/member. Every named user must already exist (have
 * logged in once) — this links rows, it does not mint logins.
 *
 * Usage: tsx src/db/seed-org.ts --name <name> [--owner-email <e>]
 *          [--admin-email <e>] [--member-email <e>] [--tier <slug>]
 */
import { ApplicationService } from "../services/application.service.js";
import { closeDatabase } from "./client.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name");
  if (!name) {
    throw new Error(
      "Usage: db:seed:org -- --name <name> [--member-email <email>]"
    );
  }
  const result = await ApplicationService.seedOrganization({
    name,
    ownerEmail: arg("--owner-email"),
    adminEmail: arg("--admin-email"),
    memberEmail: arg("--member-email"),
    tier: arg("--tier"),
  });
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
