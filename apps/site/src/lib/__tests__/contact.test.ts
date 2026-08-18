/**
 * Build-time contact addresses (#369).
 *
 * Emails are env-derived, not fetched: SSM is the single place a value is
 * written and the deploy injects it as a build env var, so the site never asks
 * the API what its own support address is.
 */
import { jest, describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const QA = "qa@portalsai.io";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Import `contact` fresh under a given environment. */
const load = async (env: Record<string, string | undefined>) => {
  jest.resetModules();
  const saved = { ...process.env };
  for (const key of ["SUPPORT_EMAIL", "SALES_EMAIL", "ADMIN_EMAIL"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    return await import("../contact.js");
  } finally {
    process.env = saved;
  }
};

describe("contact addresses (#369)", () => {
  it("reads all three addresses from the build environment", async () => {
    const c = await load({
      SUPPORT_EMAIL: "support@portalsai.io",
      SALES_EMAIL: "sales@portalsai.io",
      ADMIN_EMAIL: "admin@portalsai.io",
    });

    expect(c.supportEmail).toBe("support@portalsai.io");
    expect(c.salesEmail).toBe("sales@portalsai.io");
    expect(c.adminEmail).toBe("admin@portalsai.io");
  });

  it("falls back to the QA inbox when a var is unset", async () => {
    // The deliberate trade: with the runtime read gone an unset value can no
    // longer 503, and an address we own beats a dead `mailto:`.
    const c = await load({});

    expect(c.supportEmail).toBe(QA);
    expect(c.salesEmail).toBe(QA);
    expect(c.adminEmail).toBe(QA);
  });

  it("treats blank and whitespace-only values as unset", async () => {
    const c = await load({ SUPPORT_EMAIL: "", SALES_EMAIL: "   " });

    expect(c.supportEmail).toBe(QA);
    expect(c.salesEmail).toBe(QA);
  });

  it("trims a stray newline from a parameter value", async () => {
    // SSM values pasted by hand pick these up; a trailing newline inside a
    // `mailto:` href is silently broken.
    const c = await load({ SUPPORT_EMAIL: "support@portalsai.io\n" });

    expect(c.supportEmail).toBe("support@portalsai.io");
  });

  it("never yields an empty address", async () => {
    // The upstream guarantee behind `verify-pages.mjs`'s empty-mailto gate.
    const c = await load({});
    for (const value of [c.supportEmail, c.salesEmail, c.adminEmail]) {
      expect(value.trim()).not.toBe("");
    }
  });
});

describe("turbo passes the contact vars through to the build", () => {
  // Every test above sets `process.env` directly, so all of them passed while
  // production served `qa@` on every page: they exercise `contact.ts`'s logic
  // and never the plumbing that feeds it. Turbo 2 runs tasks in a STRICT
  // environment — a variable absent from `passThroughEnv` is stripped before
  // the build starts, so `process.env.SUPPORT_EMAIL` was simply `undefined`
  // and the fallback did exactly what it promises. Nothing failed: the deploy
  // was green, the preflight passed, and `verify-pages` was satisfied because
  // `qa@portalsai.io` is a perfectly valid address.
  //
  // The required list is derived from `contact.ts` rather than hardcoded, so a
  // NEW contact address is covered by this guard the day it is added.
  const declared: string[] = JSON.parse(read("../../../turbo.json")).tasks.build
    .passThroughEnv;

  const required = [
    ...read("../contact.ts").matchAll(/process\.env\.([A-Z0-9_]+)/g),
  ].map((m) => m[1]);

  it("reads at least one variable from the environment", () => {
    // Guards the guard: a refactor that stops using `process.env` would
    // otherwise make every assertion below vacuously true.
    expect(required.length).toBeGreaterThan(0);
  });

  it.each(required)("declares %s in passThroughEnv", (name) => {
    expect(declared).toContain(name);
  });
});
