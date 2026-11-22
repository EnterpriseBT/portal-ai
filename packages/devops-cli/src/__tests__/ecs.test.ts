/**
 * portalops' one-offs (#192, #581, #852): each wrapper hands cli-env's
 * `runApiTask` its built script. The task sequence itself (service config →
 * task def → run → wait → exit code → log) is tested in cli-env's
 * ecs-task.test.ts, where it moved in #1088.
 */

import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const { runSeedTask, runUpgradeTask, runRedispatchTask } =
  await import("../ecs.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const RESULT = { taskArn: "arn:aws:ecs:task/abc", exitCode: 0 };

beforeEach(() => {
  resetCliEnvMocks();
  mocks.runApiTask.mockResolvedValue(RESULT);
});

const spec = () => mocks.runApiTask.mock.calls[0]![1];

// #852: the runtime image has no npm (#573 removed it), so every one-off runs
// the built script with node, the same command the package's `:ci` script names.
describe("portalops one-offs", () => {
  it("seed runs the built seed script, with a local hint", async () => {
    await expect(runSeedTask(appDev)).resolves.toEqual(RESULT);
    expect(mocks.runApiTask).toHaveBeenCalledWith(appDev, expect.anything());
    expect(spec().command).toEqual(["node", "dist/db/seed.js"]);
    expect(spec().label).toBe("Seed");
    expect(spec().localHint).toMatch(/npm run db:seed/);
  });

  it("upgrade runs the built db-upgrade script, with a local hint", async () => {
    await runUpgradeTask(appDev);
    expect(spec().command).toEqual(["node", "dist/scripts/db-upgrade.js"]);
    expect(spec().localHint).toMatch(/npm run db:upgrade/);
  });

  it("redispatch runs the built jobs-redispatch script", async () => {
    await runRedispatchTask(appDev, { dryRun: false });
    expect(spec().command).toEqual(["node", "dist/scripts/jobs-redispatch.js"]);
  });

  it("redispatch passes --dry-run through", async () => {
    await runRedispatchTask(appDev, { dryRun: true });
    expect(spec().command).toEqual([
      "node",
      "dist/scripts/jobs-redispatch.js",
      "--dry-run",
    ]);
  });
});
