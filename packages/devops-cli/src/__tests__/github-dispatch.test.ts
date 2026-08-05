/**
 * `fireSiteRebuild` (#311 slice 4) — the operator-side arm of the rebuild
 * triad, fired after a `vars set` of a `siteConfig` key or a `tier apply`
 * that changed something.
 *
 * The invariant under test is that it **never blocks the write**. The
 * config change has already been committed to SSM/Postgres by the time this
 * runs; a missing token or a GitHub outage must degrade to a notice on
 * stderr and exit 0, never a non-zero exit that reads as "the write failed".
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

import { fireSiteRebuild } from "../github-dispatch.js";

// ── Harness ──────────────────────────────────────────────────────────

const mockFetch = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;

let stderr: string[];
let stderrSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response);
  process.env.GITHUB_TOKEN = "ghp_operator_token";

  stderr = [];
  stderrSpy = jest
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    }) as ReturnType<typeof jest.spyOn>;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  stderrSpy.mockRestore();
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

// ── case 1 — fires with the operator's shell token ───────────────────

describe("fireSiteRebuild", () => {
  it("POSTs a site-config-changed repository_dispatch carrying the reason", async () => {
    await fireSiteRebuild("vars set SUPPORT_EMAIL (app-dev)");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/EnterpriseBT/portal-ai/dispatches"
    );
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer ghp_operator_token"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      event_type: "site-config-changed",
      client_payload: { reason: "vars set SUPPORT_EMAIL (app-dev)" },
    });
  });

  // ── case 2 — no token: one-line notice, never a throw ──────────────

  it("prints a one-line notice and returns cleanly when GITHUB_TOKEN is unset", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(fireSiteRebuild("tier apply")).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(/GITHUB_TOKEN/);
    // The notice must not read as a failure — the write itself succeeded.
    expect(stderr.join("")).not.toMatch(/error/i);
  });

  // ── case 3 — HTTP 4xx is a warning, not an error ───────────────────

  it("warns without throwing on a non-2xx GitHub response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Resource not accessible by personal access token",
    } as unknown as Response);

    await expect(fireSiteRebuild("tier apply")).resolves.toBeUndefined();
    expect(stderr.join("")).toMatch(/403/);
  });

  // ── case 4 — a transport failure is swallowed too ──────────────────

  it("swallows a network rejection", async () => {
    mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    await expect(fireSiteRebuild("tier apply")).resolves.toBeUndefined();
    expect(stderr.join("")).toMatch(/ENOTFOUND|could not/i);
  });
});
