/**
 * BusinessConfigService (#311 slice 2) — the runtime SSM business-config
 * reader. Fail-SOFT by contract: any SSM error, missing parameter, or unset
 * BUSINESS_CONFIG_SSM_PREFIX falls back to the env vars; it never throws.
 * A stale support email is strictly better than a 503 on the public
 * endpoint (discovery → Enterprise-scale considerations).
 */

import { jest, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

/** Mutable env fixture — the service must read it at CALL time, not module
 *  load, so tests can vary it. */
const env = {
  // logger.util reads these at module load.
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  LOG_FORMAT: "json",
  SUPPORT_EMAIL: "support-env@portalsai.io",
  SALES_EMAIL: "sales-env@portalsai.io",
  BUSINESS_CONFIG_SSM_PREFIX: "",
};

jest.unstable_mockModule("../../environment.js", () => ({
  environment: env,
}));

type SsmSend = (command: { input: unknown }) => Promise<{
  Parameters?: Array<{ Name?: string; Value?: string }>;
  InvalidParameters?: string[];
}>;
const mockSend = jest.fn<SsmSend>();
const mockSsmCtor = jest.fn(() => ({ send: mockSend }));

jest.unstable_mockModule("@aws-sdk/client-ssm", () => ({
  SSMClient: mockSsmCtor,
  GetParametersCommand: jest.fn((input: unknown) => ({ input })),
}));

const { BusinessConfigService } =
  await import("../../services/business-config.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const PREFIX = "/portalai/dev";

const ssmOk = () =>
  mockSend.mockResolvedValue({
    Parameters: [
      { Name: `${PREFIX}/support-email`, Value: "support-ssm@portalsai.io" },
      { Name: `${PREFIX}/sales-email`, Value: "sales-ssm@portalsai.io" },
    ],
    InvalidParameters: [],
  });

beforeEach(() => {
  BusinessConfigService.clearCache();
  mockSend.mockReset();
  mockSsmCtor.mockClear();
  env.SUPPORT_EMAIL = "support-env@portalsai.io";
  env.SALES_EMAIL = "sales-env@portalsai.io";
  env.BUSINESS_CONFIG_SSM_PREFIX = "";
});

// ── spec §5 case 1 — SSM values win over the env fallback ────────────

it("returns SSM values when the prefix is set and the read succeeds", async () => {
  env.BUSINESS_CONFIG_SSM_PREFIX = PREFIX;
  ssmOk();

  await expect(BusinessConfigService.getContact()).resolves.toEqual({
    supportEmail: "support-ssm@portalsai.io",
    salesEmail: "sales-ssm@portalsai.io",
  });
  // The read asked for exactly the two catalog leaf paths.
  const command = mockSend.mock.calls[0][0] as {
    input: { Names: string[] };
  };
  expect(command.input.Names).toEqual([
    `${PREFIX}/support-email`,
    `${PREFIX}/sales-email`,
  ]);
});

// ── spec §5 case 2 — SSM failure falls back soft, never throws ───────

it("falls back to the env vars on an SSM error (fail-soft, no throw)", async () => {
  env.BUSINESS_CONFIG_SSM_PREFIX = PREFIX;
  mockSend.mockRejectedValue(new Error("ssm unreachable"));

  await expect(BusinessConfigService.getContact()).resolves.toEqual({
    supportEmail: "support-env@portalsai.io",
    salesEmail: "sales-env@portalsai.io",
  });
});

it("falls back per-key when a parameter is missing from the response", async () => {
  env.BUSINESS_CONFIG_SSM_PREFIX = PREFIX;
  mockSend.mockResolvedValue({
    Parameters: [
      { Name: `${PREFIX}/support-email`, Value: "support-ssm@portalsai.io" },
    ],
    InvalidParameters: [`${PREFIX}/sales-email`],
  });

  await expect(BusinessConfigService.getContact()).resolves.toEqual({
    supportEmail: "support-ssm@portalsai.io",
    salesEmail: "sales-env@portalsai.io",
  });
});

// ── spec §5 case 3 — unset prefix means SSM is never touched ─────────

it("uses env vars only — SSM client never constructed — when the prefix is unset", async () => {
  await expect(BusinessConfigService.getContact()).resolves.toEqual({
    supportEmail: "support-env@portalsai.io",
    salesEmail: "sales-env@portalsai.io",
  });
  expect(mockSsmCtor).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

// ── spec §5 case 4 — the TTL cache bounds SSM load ───────────────────

it("caches the result — a second call within the TTL does not re-read SSM", async () => {
  env.BUSINESS_CONFIG_SSM_PREFIX = PREFIX;
  ssmOk();

  await BusinessConfigService.getContact();
  await BusinessConfigService.getContact();
  expect(mockSend).toHaveBeenCalledTimes(1);

  // clearCache is the test seam — the next call reads again.
  BusinessConfigService.clearCache();
  await BusinessConfigService.getContact();
  expect(mockSend).toHaveBeenCalledTimes(2);
});
