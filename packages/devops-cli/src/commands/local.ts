/**
 * `portalops local provision` (#490) — one-shot local provisioning after a
 * full reset: pending migrations → system-row seed → tier-catalog apply →
 * optionally the e2e fixture org. Every step DELEGATES to an existing
 * implementation (`runApiScript`, `dbSeed`, `tierApply`); this command owns
 * only the composition, the per-step result shape, and stop-on-failure.
 *
 * Local-only by contract: deployed envs are provisioned by CI/deploy
 * (`db:seed:ci` ECS one-off, nightly `tier apply`). The bin gates `--env`
 * to `local` at the commander layer (usage error, exit 2); the check here
 * is library-level defense for direct callers.
 *
 * Failure shape (deliberate deviation from execute()'s either-payload-or-
 * envelope contract, see COMMANDS.md): a failed step stops the run and is
 * reported IN the steps payload with its `{code, message}`, keeping the
 * earlier steps' results; the bin maps that code to the process exit code.
 */

import {
  assertOperationAllowed,
  recordAudit,
  runApiScript,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { dbSeed } from "./db.js";
import { tierApply, tierCreate, TierAlreadyExistsError } from "./tier.js";
import type { MutateOptions } from "./vars.js";

/** The fixture org `@portalai/e2e` walks against (see packages/e2e/README.md). */
export const E2E_FIXTURE_ORG_NAME = "e2e-fixture";

/** The standing custom demo tier (#511): free, unlimited, all toolpacks. */
export const DEMO_TIER_SLUG = "demo";

/**
 * Create the local `demo` tier if absent (#511). `tierCreate`'s defaults are
 * the demo posture already — allocations null (unlimited), all built-in +
 * custom toolpacks, `cta contact`, `overage hard-deny`, no Stripe price, and
 * `public=false` + unscoped (so it's `set-tier`-able onto any local org yet
 * never appears on the marketing site's `site-config`). Idempotent: a second
 * run finds the slug and reports `exists` rather than failing.
 */
export async function ensureDemoTier(
  def: EnvironmentDefinition,
  opts: MutateOptions,
  create: typeof tierCreate = tierCreate
): Promise<{ slug: string; action: "insert" | "exists" }> {
  try {
    await create(
      def,
      {
        slug: DEMO_TIER_SLUG,
        displayName: "Demo",
        cta: "contact",
        description: "Internal demo organization — free, unlimited usage.",
      },
      opts
    );
    return { slug: DEMO_TIER_SLUG, action: "insert" };
  } catch (err) {
    if (err instanceof TierAlreadyExistsError) {
      return { slug: DEMO_TIER_SLUG, action: "exists" };
    }
    throw err;
  }
}

export interface LocalProvisionOptions extends MutateOptions {
  /** Seed the e2e fixture org, linking this member email (the user row must
   *  already exist — it is created on the test user's first login). */
  e2eOrgEmail?: string;
}

export type ProvisionStepName =
  | "migrate"
  | "seed"
  | "tier-apply"
  | "demo-tier"
  | "e2e-org";

export interface ProvisionStep {
  name: ProvisionStepName;
  status: "ok" | "skipped" | "failed";
  result?: unknown;
  error?: { code: string; message: string };
}

export interface LocalProvisionResult {
  steps: ProvisionStep[];
}

export interface LocalProvisionDeps {
  runScript?: typeof runApiScript;
  seed?: typeof dbSeed;
  apply?: typeof tierApply;
  demoTier?: typeof ensureDemoTier;
}

const stepError = (err: unknown): { code: string; message: string } => {
  const e = err as { code?: string; message?: string };
  return { code: e?.code ?? "UNKNOWN", message: e?.message ?? String(err) };
};

export async function localProvision(
  def: EnvironmentDefinition,
  opts: LocalProvisionOptions = {},
  deps: LocalProvisionDeps = {}
): Promise<LocalProvisionResult> {
  if (def.name !== "local") {
    throw new Error(
      `local provision only supports --env local (got "${def.name}") — ` +
        "deployed envs are provisioned by CI/deploy"
    );
  }
  // Uniform mutation guard (a confirmation no-op on local's development
  // kind, like the delegated steps' own guards — kept so the command's
  // semantics don't drift if the guard table ever changes).
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  const runScript = deps.runScript ?? runApiScript;
  const steps: ProvisionStep[] = [];

  const run = async (
    name: ProvisionStepName,
    fn: () => Promise<unknown>
  ): Promise<boolean> => {
    try {
      steps.push({ name, status: "ok", result: await fn() });
      return true;
    } catch (err) {
      steps.push({ name, status: "failed", error: stepError(err) });
      return false;
    }
  };

  const ok =
    (await run("migrate", async () => {
      await runScript(def, "db:migrate", []);
      return { script: "db:migrate" };
    })) &&
    (await run("seed", () => (deps.seed ?? dbSeed)(def, opts, runScript))) &&
    (await run("tier-apply", () =>
      (deps.apply ?? tierApply)(def, {
        yes: opts.yes,
        confirmProd: opts.confirmProd,
      })
    )) &&
    (await run("demo-tier", () =>
      (deps.demoTier ?? ensureDemoTier)(def, {
        yes: opts.yes,
        confirmProd: opts.confirmProd,
      })
    ));

  if (ok) {
    if (opts.e2eOrgEmail) {
      const email = opts.e2eOrgEmail;
      await run("e2e-org", async () => {
        await runScript(def, "db:seed:org", [
          "--name",
          E2E_FIXTURE_ORG_NAME,
          "--member-email",
          email,
        ]);
        return {
          script: "db:seed:org",
          orgName: E2E_FIXTURE_ORG_NAME,
          memberEmail: email,
        };
      });
    } else {
      steps.push({
        name: "e2e-org",
        status: "skipped",
        result: { reason: "--e2e-org not passed" },
      });
    }
  }

  // One line for the invocation itself; the delegated seed / tier-apply
  // steps already audit individually.
  await recordAudit({
    env: def.name,
    operator: "portalops",
    command: "local provision",
    args: {
      steps: steps.map((s) => ({ name: s.name, status: s.status })),
      e2eOrg: opts.e2eOrgEmail ?? null,
    },
  });

  return { steps };
}
