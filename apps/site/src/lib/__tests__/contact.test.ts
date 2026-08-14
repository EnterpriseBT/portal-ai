/**
 * Build-time contact addresses (#369).
 *
 * Emails are env-derived, not fetched: SSM is the single place a value is
 * written and the deploy injects it as a build env var, so the site never asks
 * the API what its own support address is.
 */
import { jest, describe, it, expect } from "@jest/globals";

const QA = "qa@portalsai.io";

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
