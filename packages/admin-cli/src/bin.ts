#!/usr/bin/env node
/**
 * portalai — thin commander wiring over the exported command functions
 * (#190). Owns flag parsing, env resolution, rendering, and the published
 * exit-code contract (2–9). All behavior lives in the library modules.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";

import { getEnvironment, type EnvironmentDefinition } from "@portalai/cli-env";

import { authLogin, authLogout } from "./commands/auth.js";
import {
  orgList,
  orgGet,
  orgUpdate,
  orgSetTier,
  orgDelete,
} from "./commands/org.js";
import { orgCreate, orgReset, seedOrg } from "./commands/provision.js";
import { userList, userGet } from "./commands/user.js";
import { memberAdd, memberRemove, memberSwitch } from "./commands/member.js";
import { exitCodeFor, jsonError, printBanner } from "./output.js";

interface GlobalOpts {
  env: string;
  json?: boolean;
  yes?: boolean;
  confirmProd?: boolean;
  [key: string]: unknown;
}

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
  const program = new Command("portalai")
    .description("Portal customer-app-data operator CLI (see packages/admin-cli/COMMANDS.md)")
    .exitOverride();

  // ── auth ───────────────────────────────────────────────────────────
  common(program.command("login").description("device-flow login for the env (the mutation session)"))
    .action(async (o: GlobalOpts) =>
      execute(o, async (def) => {
        await authLogin(def, {
          onUserCode: (uri, code) =>
            process.stderr.write(`Open to approve:\n  ${uri}\nCode: ${code}\n`),
        });
        return { env: def.name, loggedIn: true };
      })
    );
  common(program.command("logout").description("clear the env's device-flow session"))
    .action(async (o: GlobalOpts) =>
      execute(o, async (def) => {
        await authLogout(def);
        return { env: def.name, loggedOut: true };
      })
    );

  // ── org ────────────────────────────────────────────────────────────
  const org = program.command("org").description("organization management");

  common(org.command("list").description("live orgs (searchable, paginated)"))
    .option("--search <text>", "name search (case-insensitive)")
    .option("--limit <n>", "page size (default 50)")
    .option("--offset <n>", "page offset")
    .action(async (o: GlobalOpts) =>
      execute(
        o,
        async (def) => ({
          orgs: await orgList(def, {
            search: o.search as string | undefined,
            limit: o.limit ? Number(o.limit) : undefined,
            offset: o.offset ? Number(o.offset) : undefined,
          }),
        }),
        (p: { orgs: Array<{ id: string; name: string; tier: string }> }) =>
          p.orgs.map((x) => `${x.id}  ${x.tier.padEnd(10)} ${x.name}`).join("\n")
      )
    );

  common(org.command("get").description("one live org").argument("<id>"))
    .action(async (id: string, o: GlobalOpts) =>
      execute(o, async (def) => ({ org: await orgGet(def, id) }))
    );

  common(
    org.command("create").description("FULL app provisioning for an existing owner")
      .requiredOption("--name <name>", "organization name")
      .requiredOption("--owner-email <email>", "existing user (users originate in Auth0)")
  ).action(async (o: GlobalOpts) =>
    execute(o, (def) =>
      orgCreate(def, { name: o.name as string, ownerEmail: o.ownerEmail as string }, flags(o))
    )
  );

  common(org.command("update").description("patch name/timezone/default station").argument("<id>"))
    .option("--name <name>")
    .option("--timezone <tz>")
    .option("--default-station-id <id>")
    .action(async (id: string, o: GlobalOpts) =>
      execute(o, async (def) => ({
        org: await orgUpdate(
          def,
          id,
          {
            ...(o.name ? { name: o.name as string } : {}),
            ...(o.timezone ? { timezone: o.timezone as string } : {}),
            ...(o.defaultStationId ? { defaultStationId: o.defaultStationId as string } : {}),
          },
          flags(o)
        ),
      }))
    );

  common(org.command("set-tier").description("assign a subscription tier").argument("<id>").argument("<tierSlug>"))
    .action(async (id: string, tierSlug: string, o: GlobalOpts) =>
      execute(o, (def) => orgSetTier(def, id, tierSlug, flags(o)))
    );

  common(org.command("delete").description("soft-delete an org (destructive; never prod)").argument("<id>"))
    .action(async (id: string, o: GlobalOpts) =>
      execute(o, (def) => orgDelete(def, id, flags(o)))
    );

  common(org.command("reset").description("org-scoped app-data reset (destructive; never prod)").argument("<id>"))
    .action(async (id: string, o: GlobalOpts) =>
      execute(o, (def) => orgReset(def, id, flags(o)))
    );

  // ── user ───────────────────────────────────────────────────────────
  const user = program.command("user").description("read-only user lookups");

  common(user.command("list").description("live users"))
    .option("--org <orgId>", "filter to an org's live members")
    .option("--limit <n>")
    .option("--offset <n>")
    .action(async (o: GlobalOpts) =>
      execute(o, async (def) => ({
        users: await userList(def, {
          orgId: o.org as string | undefined,
          limit: o.limit ? Number(o.limit) : undefined,
          offset: o.offset ? Number(o.offset) : undefined,
        }),
      }))
    );

  common(user.command("get").description("one user by email").argument("<email>"))
    .action(async (email: string, o: GlobalOpts) =>
      execute(o, async (def) => ({ user: await userGet(def, email) }))
    );

  // ── member ─────────────────────────────────────────────────────────
  const member = program.command("member").description("org membership (by email)");

  common(member.command("add").argument("<orgId>").argument("<email>"))
    .action(async (orgId: string, email: string, o: GlobalOpts) =>
      execute(o, (def) => memberAdd(def, orgId, email, flags(o)))
    );
  common(member.command("remove").argument("<orgId>").argument("<email>"))
    .action(async (orgId: string, email: string, o: GlobalOpts) =>
      execute(o, (def) => memberRemove(def, orgId, email, flags(o)))
    );
  common(
    member.command("switch").description("make this org the user's current org in the app").argument("<orgId>").argument("<email>")
  ).action(async (orgId: string, email: string, o: GlobalOpts) =>
    execute(o, (def) => memberSwitch(def, orgId, email, flags(o)))
  );

  // ── seed ───────────────────────────────────────────────────────────
  const seed = program.command("seed").description("on-demand fixtures");

  common(
    seed.command("org").description("fully-provisioned org with a synthetic owner (never prod)")
      .requiredOption("--name <name>", "organization name (idempotency key)")
      .option("--member-email <email>", "also add this existing user as a member")
  ).action(async (o: GlobalOpts) =>
    execute(o, (def) =>
      seedOrg(def, { name: o.name as string, memberEmail: o.memberEmail as string | undefined }, flags(o))
    )
  );

  return program;
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
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return 0;
      return 2;
    }
    process.stderr.write(`error: ${(err as Error)?.message}\n`);
    return 1;
  }
}

// Binary entrypoint (skipped under test; realpath both sides — npm bins are symlinks).
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
