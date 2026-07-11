import { jest } from "@jest/globals";
import os from "node:os";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvNotAuthorizedError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

// The store is unit-tested against real Postgres; commands assert calls.
const mockStore = {
  listOrgs: jest.fn<() => Promise<unknown[]>>(),
  getOrg: jest.fn<() => Promise<unknown>>(),
  updateOrg: jest.fn<() => Promise<unknown>>(),
  setTier: jest.fn<() => Promise<unknown>>(),
  softDeleteOrg: jest.fn<() => Promise<void>>(),
  listUsers: jest.fn<() => Promise<unknown[]>>(),
  getUserByEmail: jest.fn<(email: string) => Promise<{ id: string }>>(),
  addMember: jest.fn<() => Promise<void>>(),
  removeMember: jest.fn<() => Promise<void>>(),
  switchMember: jest.fn<() => Promise<void>>(),
  close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};
const createDbAdminStoreMock = jest.fn(() => mockStore);
jest.unstable_mockModule("../store.js", () => ({
  createDbAdminStore: createDbAdminStoreMock,
}));

const { orgUpdate, orgSetTier, orgDelete } = await import("../commands/org.js");
const { memberAdd, memberSwitch } = await import("../commands/member.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"]; // kind: staging
const local = BUILTIN_ENVIRONMENTS["local"]; // kind: development

// A structurally-valid JWT whose payload carries the sub (attribution only).
const SUB = "google-oauth2|10935499";
const TOKEN = `h.${Buffer.from(JSON.stringify({ sub: SUB })).toString("base64url")}.s`;

const disposeMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  resetCliEnvMocks();
  for (const fn of Object.values(mockStore)) fn.mockReset();
  mockStore.close.mockResolvedValue(undefined);
  createDbAdminStoreMock.mockClear();
  disposeMock.mockReset().mockResolvedValue(undefined);
  mocks.resolveEnvConnection.mockResolvedValue({
    env: "x",
    kind: "staging",
    apiBaseUrl: "x",
    db: async () => ({ connectionString: "postgresql://u:p@localhost:15432/db", close: async () => {} }),
    token: async () => "t",
    dispose: disposeMock,
  });
  mocks.getToken.mockResolvedValue(TOKEN);
});

describe("the session requirement (staging/prod mutations)", () => {
  it("staging mutation with no device-flow session → ENV_NOT_AUTHORIZED naming portalai login; nothing runs", async () => {
    mocks.getToken.mockRejectedValue(new EnvNotAuthorizedError("no session"));
    const p = orgUpdate(appDev, "o-1", { name: "X" }, { yes: true });
    await expect(p).rejects.toBeInstanceOf(EnvNotAuthorizedError);
    await expect(p).rejects.toThrow(/portalai login/);
    expect(createDbAdminStoreMock).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("staging mutation with a session → audit operator is the token's sub", async () => {
    mockStore.updateOrg.mockResolvedValue({ id: "o-1", name: "X" });
    await orgUpdate(appDev, "o-1", { name: "X" }, { yes: true });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operator: SUB, command: "org update" })
    );
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("local mutations are exempt — operator falls back to the OS username", async () => {
    mocks.getToken.mockRejectedValue(new EnvNotAuthorizedError("no session"));
    mockStore.updateOrg.mockResolvedValue({ id: "o-1" });
    await orgUpdate(local, "o-1", { name: "X" }, {});
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operator: os.userInfo().username })
    );
  });
});

describe("guard classes + audit hygiene", () => {
  it("org delete is destructive-class", async () => {
    mockStore.softDeleteOrg.mockResolvedValue(undefined);
    await orgDelete(appDev, "o-1", { yes: true });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: true,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("org set-tier audits old→new, ids only", async () => {
    mockStore.setTier.mockResolvedValue({ id: "o-1", tier: "premium", previousTier: "standard" });
    const out = await orgSetTier(appDev, "o-1", "premium", { yes: true });
    expect(out).toEqual({ id: "o-1", tier: "premium", previousTier: "standard" });
    const audit = mocks.recordAudit.mock.calls[0][0] as { args: unknown };
    expect(audit).toMatchObject({
      command: "org set-tier",
      args: { orgId: "o-1", tier: "premium", previousTier: "standard" },
    });
  });

  it("store and connection are always released, even on store errors", async () => {
    mockStore.updateOrg.mockRejectedValue(new Error("boom"));
    await expect(orgUpdate(appDev, "o-1", { name: "X" }, { yes: true })).rejects.toThrow(
      "boom"
    );
    expect(mockStore.close).toHaveBeenCalled();
    expect(disposeMock).toHaveBeenCalled();
  });
});

describe("member commands (email-resolved)", () => {
  it("member add resolves the email then adds by user id", async () => {
    mockStore.getUserByEmail.mockResolvedValue({ id: "u-9" });
    mockStore.addMember.mockResolvedValue(undefined);
    const out = await memberAdd(appDev, "o-1", "ben@portalsai.io", { yes: true });
    expect(out).toEqual({ orgId: "o-1", userId: "u-9", added: true });
    expect(mockStore.addMember).toHaveBeenCalledWith("o-1", "u-9", SUB);
    const audit = mocks.recordAudit.mock.calls[0][0] as { args: unknown };
    expect(JSON.stringify(audit)).not.toContain("ben@portalsai.io".split("@")[1] + "-row");
    expect(audit).toMatchObject({ args: { orgId: "o-1", userId: "u-9" } });
  });

  it("member switch bumps the app's current-org selector", async () => {
    mockStore.getUserByEmail.mockResolvedValue({ id: "u-9" });
    mockStore.switchMember.mockResolvedValue(undefined);
    const out = await memberSwitch(appDev, "o-1", "ben@portalsai.io", { yes: true });
    expect(out).toEqual({ orgId: "o-1", userId: "u-9", switched: true });
    expect(mockStore.switchMember).toHaveBeenCalledWith("o-1", "u-9", SUB);
  });
});
