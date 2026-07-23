#!/usr/bin/env node
/**
 * portalops — thin commander wiring over the exported command functions
 * (#192). Owns: flag parsing, env resolution, output rendering, and the
 * published exit-code contract. All behavior lives in the library modules.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";

import { getEnvironment, type EnvironmentDefinition } from "@portalai/cli-env";

import {
  describeVars,
  listVars,
  getVar,
  setVar,
  applyVars,
  templateVars,
} from "./commands/vars.js";
import {
  dbTunnel,
  dbPsql,
  dbReset,
  dbSeed,
  dbResetSeed,
} from "./commands/db.js";
import {
  tierApply,
  tierCreate,
  tierUpdate,
  tierDescription,
  type TierApplyResult,
} from "./commands/tier.js";
import { exitCodeFor, jsonError, printBanner } from "./output.js";

interface GlobalOpts {
  env: string;
  json?: boolean;
  yes?: boolean;
  confirmProd?: boolean;
  unmask?: boolean;
  localPort?: string;
}

/** Shared flags on every leaf command — no implicit env, ever. */
function common(cmd: Command): Command {
  return cmd
    .requiredOption("--env <name>", "target environment (required; no default)")
    .option("--json", "machine-readable output on stdout")
    .option("--yes", "confirm a mutating operation (staging and above)")
    .option("--confirm-prod", "the production barrier flag");
}

async function execute(
  opts: GlobalOpts,
  fn: (def: EnvironmentDefinition) => Promise<unknown>,
  render: (payload: never) => string = (p) => JSON.stringify(p, null, 2)
): Promise<void> {
  try {
    const def = getEnvironment(opts.env);
    printBanner(def);
    const payload = await fn(def);
    if (payload !== undefined) {
      process.stdout.write(
        (opts.json ? JSON.stringify(payload) : render(payload as never)) + "\n"
      );
    }
  } catch (err) {
    if (opts.json) process.stdout.write(jsonError(err) + "\n");
    else process.stderr.write(`error: ${(err as Error)?.message}\n`);
    process.exitCode = exitCodeFor(err);
  }
}

const flags = (o: GlobalOpts) => ({ yes: o.yes, confirmProd: o.confirmProd });

export function buildProgram(): Command {
  const program = new Command("portalops")
    .description(
      "Portal infrastructure operator CLI (see packages/devops-cli/COMMANDS.md)"
    )
    .exitOverride();

  // ── vars ───────────────────────────────────────────────────────────
  const vars = program
    .command("vars")
    .description("managed Secrets Manager / SSM config");

  common(
    vars
      .command("describe")
      .description("the catalog + resolved paths (no values)")
  ).action(async (o: GlobalOpts) =>
    execute(
      o,
      (def) => describeVars(def),
      (p: Awaited<ReturnType<typeof describeVars>>) =>
        p.entries
          .map((e) => `${e.key.padEnd(32)} ${e.kind.padEnd(8)} ${e.path}`)
          .join("\n")
    )
  );

  common(
    vars
      .command("list")
      .description("every key with its live value (secrets masked)")
  )
    .option("--unmask", "reveal secret values")
    .action(async (o: GlobalOpts) =>
      execute(
        o,
        (def) => listVars(def, { unmask: o.unmask }),
        (p: Awaited<ReturnType<typeof listVars>>) =>
          p.entries
            .map((e) => `${e.key.padEnd(32)} ${e.kind.padEnd(8)} ${e.value}`)
            .join("\n")
      )
    );

  common(
    vars.command("get").description("one raw value").argument("<key>")
  ).action(async (key: string, o: GlobalOpts) =>
    execute(
      o,
      (def) => getVar(def, key),
      (p: Awaited<ReturnType<typeof getVar>>) => p.value
    )
  );

  common(
    vars
      .command("set")
      .description("write one value ('-' reads stdin)")
      .argument("<key>")
      .argument("<value>")
  ).action(async (key: string, value: string, o: GlobalOpts) =>
    execute(o, async (def) => {
      const res = await setVar(def, key, value, flags(o));
      if (res.created) {
        process.stderr.write(
          "warning: created a NEW secret — add its ARN to the deploy workflow / CloudFormation before deploying\n"
        );
      }
      return res;
    })
  );

  common(
    vars
      .command("apply")
      .description("batch-apply a KEY=VALUE env file")
      .argument("<file>")
  ).action(async (file: string, o: GlobalOpts) =>
    execute(o, (def) => applyVars(def, file, flags(o)))
  );

  common(
    vars
      .command("template")
      .description("write a pre-filled env file (0600, plaintext!)")
      .argument("[out]")
  ).action(async (outPath: string | undefined, o: GlobalOpts) =>
    execute(o, async (def) => {
      const res = await templateVars(def, outPath);
      process.stderr.write(`warning: ${res.warning}\n`);
      return res;
    })
  );

  // ── db ─────────────────────────────────────────────────────────────
  const db = program
    .command("db")
    .description("database operations over the env connection");

  common(
    db.command("tunnel").description("open the DB tunnel and stay attached")
  )
    .option("--local-port <n>", "local port (default 15432)")
    .action(async (o: GlobalOpts) =>
      execute(o, async (def) => {
        const t = await dbTunnel(def, {
          confirmProd: o.confirmProd,
          localPort: o.localPort ? Number(o.localPort) : undefined,
        });
        process.stderr.write(
          `tunnel open — connect with:\n  psql "${t.connectionString}"\nCtrl+C to close\n`
        );
        await new Promise(() => {}); // hold open; cli-env signal hooks clean up
        return undefined;
      })
    );

  common(
    db
      .command("psql")
      .description("psql through the tunnel (args after -- pass through)")
      .argument("[args...]")
      .allowUnknownOption(true)
  ).action(async (args: string[], o: GlobalOpts) =>
    execute(o, async (def) => {
      const { exitCode } = await dbPsql(def, {
        confirmProd: o.confirmProd,
        args: args ?? [],
      });
      if (exitCode !== 0) process.exitCode = exitCode;
      return undefined;
    })
  );

  common(
    db
      .command("reset")
      .description("DROP er__* + TRUNCATE the rest (destructive; never prod)")
  ).action(async (o: GlobalOpts) =>
    execute(o, (def) => dbReset(def, flags(o)))
  );

  common(
    db.command("seed").description("run db:seed:ci as an ECS one-off task")
  ).action(async (o: GlobalOpts) => execute(o, (def) => dbSeed(def, flags(o))));

  common(db.command("reset-seed").description("reset, then seed")).action(
    async (o: GlobalOpts) => execute(o, (def) => dbResetSeed(def, flags(o)))
  );

  // ── tier (#218) ────────────────────────────────────────────────────
  const tier = program
    .command("tier")
    .description("tier catalog provisioning over Stripe lookup keys");

  common(
    tier
      .command("apply")
      .description("converge declared tier rows to the in-repo catalog")
  )
    .option("--dry-run", "compute and print the diff; write nothing")
    .action(async (o: GlobalOpts & { dryRun?: boolean }) =>
      execute(
        o,
        (def) => tierApply(def, { ...flags(o), dryRun: o.dryRun }),
        renderTierApply as never
      )
    );

  // #241: per-client custom tier lifecycle (create/update/describe). Switching
  // an org ONTO a tier stays in `portalai org set-tier` (customer app data).
  type TierWriteFlags = GlobalOpts & {
    slug?: string;
    displayName?: string;
    cta?: string;
    overage?: string;
    stripePriceId?: string;
    visibleToOrg?: string;
    description?: string;
  };
  const writeInput = (o: TierWriteFlags) => ({
    slug: o.slug as string,
    displayName: o.displayName,
    cta: o.cta,
    overage: o.overage,
    stripePriceId: o.stripePriceId,
    visibleToOrganizationId: o.visibleToOrg,
    description: o.description,
  });

  common(
    tier
      .command("create")
      .description(
        "create a custom tier row (defaults: contact CTA, unlimited)"
      )
      .requiredOption(
        "--slug <slug>",
        "unique tier slug (e.g. acme_enterprise)"
      )
      .requiredOption("--display-name <name>", "human display name")
      .option("--cta <kind>", "subscribe | contact | none (default: contact)")
      .option("--visible-to-org <orgId>", "scope to one org (omit = public)")
      .option("--description <text>", "operator blurb")
      .option("--overage <mode>", "hard-deny | soft-alert (default: hard-deny)")
      .option("--stripe-price-id <id>", "for a subscribe custom tier")
  ).action(async (o: TierWriteFlags) =>
    execute(o, (def) => tierCreate(def, writeInput(o), flags(o)))
  );

  common(
    tier
      .command("update")
      .description("update a custom tier's fields (only those provided)")
      .requiredOption("--slug <slug>", "the tier to update")
      .option("--display-name <name>", "human display name")
      .option("--cta <kind>", "subscribe | contact | none")
      .option("--visible-to-org <orgId>", "scope to one org")
      .option("--description <text>", "operator blurb")
      .option("--overage <mode>", "hard-deny | soft-alert")
      .option("--stripe-price-id <id>", "Stripe price id")
  ).action(async (o: TierWriteFlags) =>
    execute(o, (def) => tierUpdate(def, writeInput(o), flags(o)))
  );

  common(
    tier
      .command("description")
      .description("set or clear a tier's blurb (excluded from tier apply)")
      .requiredOption("--slug <slug>", "the tier to edit")
      .option("--set <text>", "the blurb text")
      .option("--clear", "clear the blurb (set to null)")
  ).action(
    async (o: GlobalOpts & { slug?: string; set?: string; clear?: boolean }) =>
      execute(o, (def) => {
        if (o.clear && o.set !== undefined) {
          throw new Error("pass either --set or --clear, not both");
        }
        if (!o.clear && o.set === undefined) {
          throw new Error("pass --set <text> or --clear");
        }
        return tierDescription(
          def,
          o.slug as string,
          o.clear ? null : (o.set as string),
          flags(o)
        );
      })
  );

  return program;
}

/** Human render for `tier apply` — per-slug field diff + unmanaged note. */
function renderTierApply(result: TierApplyResult): string {
  const lines: string[] = [];
  for (const change of result.changes) {
    lines.push(`${change.slug}: ${change.action}`);
    for (const [field, { from, to }] of Object.entries(change.fields)) {
      lines.push(`  ${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
    }
  }
  if (result.unmanaged.length > 0) {
    lines.push(`unmanaged (untouched): ${result.unmanaged.join(", ")}`);
  }
  const allNoop = result.changes.every((c) => c.action === "noop");
  lines.push(
    result.dryRun
      ? "dry run — nothing written"
      : allNoop
        ? "nothing to apply — already converged"
        : "applied"
  );
  return lines.join("\n");
}

/** Parse + run; returns the process exit code (the published contract). */
export async function runCli(argv: string[]): Promise<number> {
  const program = buildProgram();
  const prior = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(argv, { from: "user" });
    const code = typeof process.exitCode === "number" ? process.exitCode : 0;
    process.exitCode = prior;
    return code;
  } catch (err) {
    process.exitCode = prior;
    if (err instanceof CommanderError) {
      if (
        err.code === "commander.helpDisplayed" ||
        err.code === "commander.version"
      )
        return 0;
      return 2; // usage errors
    }
    process.stderr.write(`error: ${(err as Error)?.message}\n`);
    return 1;
  }
}

// Binary entrypoint (skipped under test, where bin.js is imported).
// realpath both sides: npm installs bins as symlinks into node_modules/.bin.
const invokedAs = process.argv[1]
  ? (() => {
      try {
        return fs.realpathSync(process.argv[1]);
      } catch {
        return process.argv[1];
      }
    })()
  : null;
if (invokedAs && invokedAs === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
