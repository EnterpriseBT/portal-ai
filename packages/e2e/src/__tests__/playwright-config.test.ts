import {
  SESSION_STORAGE_STATE,
  artifactsArePublishable,
  buildConfig,
} from "../lib/playwright-config.js";
import { resolveTarget } from "../lib/target.js";

describe("buildConfig", () => {
  const local = buildConfig(resolveTarget({}), {});
  const ci = buildConfig(resolveTarget({}), { CI: "1" });
  const prod = buildConfig(resolveTarget({ E2E_TARGET: "prod" }), {});

  it("never traces a deployed run (a trace records the QA password and token)", () => {
    expect(prod.use?.trace).toBe("off");
    expect(local.use?.trace).toBe("on-first-retry");
  });

  // A video holds every frame of the typing, including a password typed
  // into the wrong field (#963), so a publishable run records none.
  it("records no video in CI or for a deployed run, and keeps it locally", () => {
    expect(ci.use?.video).toBe("off");
    expect(prod.use?.video).toBe("off");
    expect(local.use?.video).toBe("retain-on-failure");
  });

  it("writes no HTML report for a deployed run", () => {
    expect(prod.reporter).toEqual([["list"]]);
    expect(JSON.stringify(local.reporter)).toContain("html");
  });

  // This repo is public, so a CI artifact is downloadable by anyone: the
  // report's step titles and a trace both carry the typed password.
  it("records no trace and no HTML report in CI, even on the local stack", () => {
    expect(ci.use?.trace).toBe("off");
    expect(ci.reporter).toEqual([["list"]]);
    expect(artifactsArePublishable(resolveTarget({}), { CI: "1" })).toBe(true);
    expect(artifactsArePublishable(resolveTarget({}), {})).toBe(false);
    expect(
      artifactsArePublishable(resolveTarget({ E2E_TARGET: "prod" }), {})
    ).toBe(true);
  });

  it("runs only the login check against a deployed target", () => {
    expect((prod.projects ?? []).map((p) => p.name)).toEqual(["login"]);
    expect((local.projects ?? []).map((p) => p.name).sort()).toEqual([
      "a11y",
      "a11y-site",
      "core-loop",
      "login",
      "roles",
      "setup",
    ]);
  });

  // The accessibility walks (#792) record findings and never fail on them,
  // run only against a local stack, and are never named by CI's explicit
  // project list.
  it("runs the accessibility walks only against a local target, never retrying", () => {
    const names = (prod.projects ?? []).map((p) => p.name);
    expect(names).not.toContain("a11y");
    expect(names).not.toContain("a11y-site");
    for (const name of ["a11y", "a11y-site"]) {
      const project = (local.projects ?? []).find((p) => p.name === name);
      expect(project?.retries).toBe(0);
      expect(project?.dependencies ?? []).toEqual([]);
    }
  });

  it("points the site walk at astro preview, overridable with E2E_SITE_BASE_URL", () => {
    const site = (cfg: typeof local) =>
      (cfg.projects ?? []).find((p) => p.name === "a11y-site")?.use?.baseURL;
    expect(site(local)).toBe("http://localhost:3002");
    expect(
      site(
        buildConfig(resolveTarget({}), {
          E2E_SITE_BASE_URL: "http://localhost:4321",
        })
      )
    ).toBe("http://localhost:4321");
  });

  it("gives a test long enough for a slow Auth0 round trip", () => {
    expect(prod.timeout).toBeGreaterThanOrEqual(120_000);
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

  // An accepted invite can't be replayed on the same database, so a retry
  // would fail for the wrong reason.
  it("runs the role split as the owner, after setup, never retrying", () => {
    const roles = (local.projects ?? []).find((p) => p.name === "roles");
    expect(roles?.retries).toBe(0);
    expect(roles?.dependencies).toEqual(["setup"]);
    expect(roles?.use?.storageState).toBe(SESSION_STORAGE_STATE);
  });
});
