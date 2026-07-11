/**
 * `db:create-org` — provision a full organization for an EXISTING user
 * (#190, the portalai CLI's `org create` spawn target). Rides the same
 * ApplicationService transaction the Auth0 webhook uses.
 *
 * Usage: tsx src/db/create-org.ts --owner-email <email> --name <name>
 */
import { ApplicationService } from "../services/application.service.js";
import { closeDatabase } from "./client.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const ownerEmail = arg("--owner-email");
  const name = arg("--name");
  if (!ownerEmail || !name) {
    throw new Error("Usage: db:create-org -- --owner-email <email> --name <name>");
  }
  const result = await ApplicationService.createOrganizationForEmail(
    ownerEmail,
    name
  );
  console.log(
    JSON.stringify({
      organizationId: result.organization.id,
      stationId: result.organization.defaultStationId ?? null,
    })
  );
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
