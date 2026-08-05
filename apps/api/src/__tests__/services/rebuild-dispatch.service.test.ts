/**
 * RebuildDispatchService (#311 slice 4) — the API-side arm of the rebuild
 * triad (Stripe price webhook here; `portalops` hooks and the nightly
 * schedule are the other two).
 *
 * The whole contract is "never throws". It fires from inside a Stripe
 * webhook handler, where an exception would turn a successfully-recorded
 * event into a 500 and provoke a Stripe retry — republishing the site is
 * never worth breaking billing ingestion. Every degradation below is a log
 * line and a clean return.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const { RebuildDispatchService } =
  await import("../../services/rebuild-dispatch.service.js");
const { environment } = await import("../../environment.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const ok = () => ({ ok: true, status: 204 }) as Response;

beforeEach(() => {
  mockFetch.mockReset();
  environment.GITHUB_DISPATCH_TOKEN = "ghp_test_token";
  environment.GITHUB_DISPATCH_REPO = "EnterpriseBT/portal-ai";
});

describe("RebuildDispatchService.fireSiteRebuild", () => {
  // ── case 1 — fires the repository_dispatch with the token ──────────
  it("POSTs a site-config-changed repository_dispatch carrying the reason", async () => {
    mockFetch.mockResolvedValue(ok());

    await RebuildDispatchService.fireSiteRebuild("stripe:price.updated");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/EnterpriseBT/portal-ai/dispatches"
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer ghp_test_token"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      event_type: "site-config-changed",
      client_payload: { reason: "stripe:price.updated" },
    });
  });

  // ── case 2 — unset token is a silent no-op, not an error ───────────
  it("no-ops without calling GitHub when the token is unset", async () => {
    environment.GITHUB_DISPATCH_TOKEN = "";

    await expect(
      RebuildDispatchService.fireSiteRebuild("stripe:price.created")
    ).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── case 3 — an HTTP failure is swallowed ──────────────────────────
  it("swallows a non-2xx GitHub response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Bad credentials",
    } as unknown as Response);

    await expect(
      RebuildDispatchService.fireSiteRebuild("vars:SUPPORT_EMAIL")
    ).resolves.toBeUndefined();
  });

  // ── case 4 — a transport rejection is swallowed ────────────────────
  it("swallows a network rejection", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      RebuildDispatchService.fireSiteRebuild("stripe:price.deleted")
    ).resolves.toBeUndefined();
  });
});
