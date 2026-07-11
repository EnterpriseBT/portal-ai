/**
 * `db:seed:org` — idempotent-by-name org fixture with a synthetic owner
 * (#190, the portalai CLI's `seed org` spawn target). Optionally adds a
 * real user as a member so the org is enterable from the app.
 *
 * Usage: tsx src/db/seed-org.ts --name <name> [--member-email <email>]
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
    throw new Error("Usage: db:seed:org -- --name <name> [--member-email <email>]");
  }
  const result = await ApplicationService.seedOrganization({
    name,
    memberEmail: arg("--member-email"),
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
