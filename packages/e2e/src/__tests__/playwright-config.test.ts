import {
  SESSION_STORAGE_STATE,
  buildConfig,
} from "../lib/playwright-config.js";
import { resolveTarget } from "../lib/target.js";

describe("buildConfig", () => {
  const local = buildConfig(resolveTarget({}));
  const prod = buildConfig(resolveTarget({ E2E_TARGET: "prod" }));

  it("never traces a deployed run (a trace records the QA password and token)", () => {
    expect(prod.use?.trace).toBe("off");
    expect(local.use?.trace).toBe("on-first-retry");
  });

  it("writes no HTML report for a deployed run", () => {
    expect(prod.reporter).toEqual([["list"]]);
    expect(JSON.stringify(local.reporter)).toContain("html");
  });

  it("keeps each target's artifacts in its own directory", () => {
    expect(prod.outputDir).toBe("./test-results/prod");
    expect(local.outputDir).toBe("./test-results/local");
  });

  it("points the browser at the target's web app", () => {
    expect(prod.use?.baseURL).toBe("https://app.portalsai.io");
  });

  it("retries the core loop once and the login never", () => {
    const byName = Object.fromEntries(
      (local.projects ?? []).map((p) => [p.name, p])
    );
    expect(byName["login"].retries).toBe(0);
    expect(byName["core-loop"].retries).toBe(1);
    expect(byName["core-loop"].dependencies).toEqual(["setup"]);
    expect(byName["core-loop"].use?.storageState).toBe(SESSION_STORAGE_STATE);
    // the walk's session must never land in the uploaded artifacts
    expect(SESSION_STORAGE_STATE).not.toMatch(/test-results/);
  });
});
