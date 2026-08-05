/**
 * Deploy-time preflight (#319 slice 1). The runner fetches the site-config
 * endpoint before the build; `evaluate` is the pure classifier it calls, and
 * the only unit-testable seam — the fetch/retry/`::error::` wiring is
 * exercised by the deploy smoke walk, not here.
 *
 * These cases mirror the endpoint's real envelopes: a 200 wraps the snapshot
 * as `{ success, payload: { tiers, contact, generatedAt } }`; a fail-closed
 * 503 is `{ success:false, message, code }`.
 */

import { describe, it, expect } from "@jest/globals";

import { evaluate } from "../preflight-site-config.mjs";

const ok200 = (tiers: unknown[]) => ({
  status: 200,
  body: { success: true, payload: { tiers, contact: {}, generatedAt: "x" } },
});

describe("evaluate", () => {
  // ── case 1 — healthy: 200 with at least one tier ───────────────────
  it("passes a 200 with a non-empty tiers array", () => {
    const r = evaluate({
      ...ok200([{ slug: "standard" }]),
      portalopsEnv: "app-dev",
    });
    expect(r.ok).toBe(true);
  });

  // ── case 2 — 200 but no public tiers → tier apply ──────────────────
  it("fails a 200 with empty tiers and names `tier apply`", () => {
    const r = evaluate({ ...ok200([]), portalopsEnv: "app-dev" });
    expect(r.ok).toBe(false);
    expect(r.remediation).toContain("tier apply");
    expect(r.remediation).toContain("--env app-dev");
  });

  // ── case 3 — 503 contact unresolved → both vars set lines ──────────
  it("fails a 503 CONTACT_UNRESOLVED and names both contact vars", () => {
    const r = evaluate({
      status: 503,
      body: {
        success: false,
        code: "SITE_CONFIG_CONTACT_UNRESOLVED",
        message: "…",
      },
      portalopsEnv: "app-dev",
    });
    expect(r.ok).toBe(false);
    expect(r.remediation).toContain("vars set SUPPORT_EMAIL");
    expect(r.remediation).toContain("vars set SALES_EMAIL");
    expect(r.remediation).toContain("--env app-dev");
    expect(r.remediation).not.toContain("--confirm-prod");
  });

  // ── case 4 — same, prod → --confirm-prod ───────────────────────────
  it("adds --confirm-prod to the remediation when isProd", () => {
    const r = evaluate({
      status: 503,
      body: {
        success: false,
        code: "SITE_CONFIG_CONTACT_UNRESOLVED",
        message: "…",
      },
      portalopsEnv: "prod",
      isProd: true,
    });
    expect(r.ok).toBe(false);
    expect(r.remediation).toContain("--env prod");
    expect(r.remediation).toContain("--confirm-prod");
  });

  // ── case 5 — 503 price unresolved → names the slug ─────────────────
  it("fails a 503 PRICE_UNRESOLVED and names the tier slug", () => {
    const r = evaluate({
      status: 503,
      body: {
        success: false,
        code: "SITE_CONFIG_PRICE_UNRESOLVED",
        message: "Price for public tier 'plus' could not be resolved",
      },
      portalopsEnv: "app-dev",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("plus");
  });

  // ── case 6 — transport / auth / gateway → names the status ─────────
  it("fails a 401 and a 502, naming the status", () => {
    for (const status of [401, 502]) {
      const r = evaluate({ status, body: null, portalopsEnv: "app-dev" });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(String(status));
    }
  });

  // ── case 7 — 200 with a malformed/empty body → safe, no throw ──────
  it("fails safely on a 200 whose body has no parseable tiers", () => {
    expect(() =>
      evaluate({ status: 200, body: null, portalopsEnv: "app-dev" })
    ).not.toThrow();
    const r = evaluate({ status: 200, body: null, portalopsEnv: "app-dev" });
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe("string");
  });
});
