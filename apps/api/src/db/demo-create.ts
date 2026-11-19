/**
 * `db:demo:create` (#1035) — provision a brand-new demo org and load the demo
 * dataset onto its own station. The spawn target for `portalai demo create`
 * (via `runApiScript`), which validates the same inputs first and fills in the
 * defaults, so every argument is required here.
 *
 * Usage: tsx src/db/demo-create.ts --name <name> --owner-email <email>
 *          --tier <slug> --rows <n>
 *
 * The org, its marker, tier and Demo station commit in one transaction; the
 * dataset load runs after. A load that throws soft-deletes the org this run
 * created (the full organization deletion), so a failed create leaves nothing
 * behind and a retry is a plain re-run. A run killed mid-load can't clean up:
 * the org stays, marked, and `portalai org list --search <name>` finds it for
 * `portalai demo delete`. (The id line below goes to stderr, which the CLI
 * buffers, so it is shown only when the script exits non-zero.)
 */
import { pathToFileURL } from "node:url";

import { DemoOrganizationCreateInputSchema } from "@portalai/core/contracts";

import { ApplicationService } from "../services/application.service.js";
import { DemoSeedService } from "../services/demo-seed.service.js";
import { closeDatabase } from "./client.js";

const USAGE =
  "Usage: db:demo:create -- --name <name> --owner-email <email> --tier <slug> --rows <n>";

export interface DemoCreateSteps {
  create: typeof ApplicationService.createDemoOrganization;
  seed: typeof DemoSeedService.seed;
  discard: (organizationId: string) => Promise<unknown>;
}

export const DEFAULT_DEMO_CREATE_STEPS: DemoCreateSteps = {
  create: (opts) => ApplicationService.createDemoOrganization(opts),
  seed: (params) => DemoSeedService.seed(params),
  discard: (organizationId) =>
    ApplicationService.discardDemoOrganization(organizationId),
};

export interface DemoCreateIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const processIo: DemoCreateIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse, create, seed, report. Returns the exit code. */
export async function runDemoCreate(
  argv: string[],
  steps: DemoCreateSteps = DEFAULT_DEMO_CREATE_STEPS,
  io: DemoCreateIo = processIo
): Promise<number> {
  const ownerEmail = arg(argv, "--owner-email");
  const tier = arg(argv, "--tier");

  const usage = (detail: string) => {
    io.err(`${USAGE} (${detail})`);
    return 1;
  };
  if (!ownerEmail) return usage("--owner-email is required");
  if (!tier) return usage("--tier is required");
  // The rule the CLI checks too (core), so a direct run can't diverge.
  const parsed = DemoOrganizationCreateInputSchema.safeParse({
    name: arg(argv, "--name") ?? "",
    rows: arg(argv, "--rows") ?? "",
  });
  if (!parsed.success) {
    return usage(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const { name, rows } = parsed.data;

  let created: { organizationId: string; stationId: string };
  try {
    created = await steps.create({ ownerEmail, name, tier });
  } catch (err) {
    io.err(message(err));
    return 1;
  }
  const { organizationId, stationId } = created;
  io.err(`demo org ${organizationId} created; loading dataset`);

  try {
    const result = await steps.seed({ orgId: organizationId, stationId, rows });
    io.out(
      JSON.stringify({
        organizationId,
        stationId,
        tier,
        rows: result.rows,
        entities: result.entities.length,
        toolpacks: result.toolpacks,
        durationMs: result.durationMs,
      })
    );
    return 0;
  } catch (err) {
    try {
      await steps.discard(organizationId);
      io.err(
        `demo create failed; org ${organizationId} deleted: ${message(err)}`
      );
    } catch (cleanupErr) {
      io.err(
        `demo create failed and cleanup failed (${message(cleanupErr)}); run: portalai demo delete ${organizationId}. Load error: ${message(err)}`
      );
    }
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runDemoCreate(process.argv.slice(2))
    .catch((err) => {
      console.error(message(err));
      return 1;
    })
    .then(async (code) => {
      await closeDatabase().catch(() => {});
      process.exit(code);
    });
}
