import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";

const findCurrentByConnectorInstanceIdMock =
  jest.fn<
    (
      connectorInstanceId: string
    ) => Promise<{ id: string; plan: unknown } | undefined>
  >();
const updateInstanceMock =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const softDeleteBeforeWatermarkMock =
  jest.fn<
    (
      connectorEntityId: string,
      runStartedAt: number,
      userId: string
    ) => Promise<number>
  >();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: { update: updateInstanceMock },
      connectorInstanceLayoutPlans: {
        findCurrentByConnectorInstanceId:
          findCurrentByConnectorInstanceIdMock,
      },
      entityRecords: {
        softDeleteBeforeWatermark: softDeleteBeforeWatermarkMock,
      },
    },
  },
}));

const fetchWorkbookForSyncMock =
  jest.fn<(id: string, organizationId: string) => Promise<unknown>>();
jest.unstable_mockModule(
  "../../services/microsoft-excel-connector.service.js",
  () => ({
    MicrosoftExcelConnectorService: {
      fetchWorkbookForSync: fetchWorkbookForSyncMock,
    },
  })
);

const commitMock =
  jest.fn<
    (
      ciId: string,
      planId: string,
      orgId: string,
      userId: string,
      input: unknown,
      opts: unknown
    ) => Promise<{
      recordCounts: { created: number; updated: number; unchanged: number };
      connectorEntityIds: string[];
    }>
  >();
jest.unstable_mockModule(
  "../../services/layout-plan-commit.service.js",
  () => ({
    LayoutPlanCommitService: { commit: commitMock },
  })
);

const assertSyncEligibleIdentityMock =
  jest.fn<() => { identityWarnings: { regionId: string }[] }>();
jest.unstable_mockModule("../../services/sync-eligibility.util.js", () => ({
  assertSyncEligibleIdentity: assertSyncEligibleIdentityMock,
}));

const { microsoftExcelAdapter } = await import(
  "../../adapters/microsoft-excel/microsoft-excel.adapter.js"
);

const INSTANCE = {
  id: "ci-msft-1",
  organizationId: "org-1",
  connectorDefinitionId: "def-1",
  name: "Microsoft 365 Excel (alice@contoso.com)",
  status: "active" as const,
  config: { driveItemId: "01ABC", name: "Q3.xlsx", fetchedAt: 0 },
  credentials: {
    refresh_token: "rt",
    microsoftAccountUpn: "alice@contoso.com",
    microsoftAccountEmail: "alice@contoso.com",
    microsoftAccountDisplayName: "Alice",
    tenantId: "tenant-A",
    scopes: [],
    lastRefreshedAt: 0,
  },
  lastSyncAt: null,
  lastErrorMessage: null,
  enabledCapabilityFlags: null,
  created: 0,
  createdBy: "u",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

beforeEach(() => {
  findCurrentByConnectorInstanceIdMock.mockReset();
  updateInstanceMock.mockReset();
  softDeleteBeforeWatermarkMock.mockReset();
  fetchWorkbookForSyncMock.mockReset();
  commitMock.mockReset();
  assertSyncEligibleIdentityMock.mockReset();
  assertSyncEligibleIdentityMock.mockReturnValue({ identityWarnings: [] });
});

describe("microsoftExcelAdapter.toPublicAccountInfo", () => {
  it("returns identity + metadata from a complete credentials blob", () => {
    const out = microsoftExcelAdapter.toPublicAccountInfo!(
      INSTANCE.credentials
    );
    expect(out).toEqual({
      identity: "alice@contoso.com",
      metadata: {
        email: "alice@contoso.com",
        displayName: "Alice",
        tenantId: "tenant-A",
      },
    });
  });

  it("returns EMPTY_ACCOUNT_INFO for null credentials", () => {
    const out = microsoftExcelAdapter.toPublicAccountInfo!(null);
    expect(out).toEqual({ identity: null, metadata: {} });
  });

  it("returns EMPTY_ACCOUNT_INFO when UPN is missing", () => {
    const out = microsoftExcelAdapter.toPublicAccountInfo!({
      tenantId: "t-1",
    });
    expect(out).toEqual({ identity: null, metadata: {} });
  });

  it("omits the email key when mail is null (personal MSA)", () => {
    const out = microsoftExcelAdapter.toPublicAccountInfo!({
      microsoftAccountUpn: "bob_outlook.com#EXT#@bob.onmicrosoft.com",
      microsoftAccountEmail: null,
      microsoftAccountDisplayName: "Bob",
      tenantId: "9188040d-6c67-4c5b-b112-36a304b66dad",
    });
    expect(out.identity).toBe("bob_outlook.com#EXT#@bob.onmicrosoft.com");
    expect(out.metadata.email).toBeUndefined();
    expect(out.metadata.tenantId).toBe(
      "9188040d-6c67-4c5b-b112-36a304b66dad"
    );
  });
});

describe("microsoftExcelAdapter.assertSyncEligibility", () => {
  it("refuses when no layout plan is committed", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue(undefined);
    const out = await microsoftExcelAdapter.assertSyncEligibility!(
      INSTANCE as never
    );
    expect(out.ok).toBe(false);
    expect(out.reasonCode).toBe(ApiCode.LAYOUT_PLAN_NOT_FOUND);
  });

  it("returns ok with empty identityWarnings for columnHeader plans", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue({
      id: "plan-1",
      plan: {},
    });
    assertSyncEligibleIdentityMock.mockReturnValueOnce({
      identityWarnings: [],
    });
    const out = await microsoftExcelAdapter.assertSyncEligibility!(
      INSTANCE as never
    );
    expect(out.ok).toBe(true);
    expect(out.identityWarnings).toEqual([]);
  });

  it("returns ok with identityWarnings for rowPosition plans (advisory, not blocking)", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue({
      id: "plan-1",
      plan: {},
    });
    assertSyncEligibleIdentityMock.mockReturnValueOnce({
      identityWarnings: [{ regionId: "r-1" }],
    });
    const out = await microsoftExcelAdapter.assertSyncEligibility!(
      INSTANCE as never
    );
    expect(out.ok).toBe(true);
    expect(out.identityWarnings).toEqual([{ regionId: "r-1" }]);
  });
});

describe("microsoftExcelAdapter.syncInstance", () => {
  it("happy path: fetch → commit → reap → mark synced; returns merged record counts", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue({
      id: "plan-1",
      plan: {},
    });
    fetchWorkbookForSyncMock.mockResolvedValue({ sheets: [] });
    commitMock.mockResolvedValue({
      recordCounts: { created: 3, updated: 1, unchanged: 7 },
      connectorEntityIds: ["ce-1", "ce-2"],
    });
    softDeleteBeforeWatermarkMock.mockResolvedValueOnce(2);
    softDeleteBeforeWatermarkMock.mockResolvedValueOnce(1);

    const progress = jest.fn();
    const result = await microsoftExcelAdapter.syncInstance!(
      INSTANCE as never,
      "user-1",
      progress
    );

    expect(result.recordCounts).toEqual({
      created: 3,
      updated: 1,
      unchanged: 7,
      deleted: 3,
    });
    expect(fetchWorkbookForSyncMock).toHaveBeenCalledWith(
      INSTANCE.id,
      INSTANCE.organizationId
    );

    // Commit is called with skipDriftGate: true and a captured runStartedAt.
    expect(commitMock).toHaveBeenCalledTimes(1);
    const commitArgs = commitMock.mock.calls[0]!;
    const opts = commitArgs[5] as Record<string, unknown>;
    expect(opts.skipDriftGate).toBe(true);
    expect(typeof opts.syncedAt).toBe("number");

    // Per-entity reap with the SAME runStartedAt.
    expect(softDeleteBeforeWatermarkMock).toHaveBeenCalledTimes(2);
    const watermarks = softDeleteBeforeWatermarkMock.mock.calls.map(
      (c) => c[1]
    );
    expect(watermarks[0]).toBe(opts.syncedAt);
    expect(watermarks[1]).toBe(opts.syncedAt);

    // Mark synced + clear errors.
    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, patch] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe(INSTANCE.id);
    expect(typeof patch.lastSyncAt).toBe("number");
    expect(patch.lastErrorMessage).toBeNull();
    expect(patch.updatedBy).toBe("user-1");

    // Progress milestones in expected order.
    const reportedPercents = progress.mock.calls.map((c) => c[0]);
    expect(reportedPercents).toEqual([0, 10, 40, 80, 95, 100]);
  });

  it("throws ApiError(404, LAYOUT_PLAN_NOT_FOUND) when no plan exists", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue(undefined);
    try {
      await microsoftExcelAdapter.syncInstance!(INSTANCE as never, "user-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
      expect((err as { code?: string }).code).toBe(
        ApiCode.LAYOUT_PLAN_NOT_FOUND
      );
    }
    expect(fetchWorkbookForSyncMock).not.toHaveBeenCalled();
    expect(updateInstanceMock).not.toHaveBeenCalled();
  });

  it("propagates fetch errors without marking lastSyncAt", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue({
      id: "plan-1",
      plan: {},
    });
    fetchWorkbookForSyncMock.mockRejectedValue(
      Object.assign(new Error("AADSTS70008: refresh token expired"), {
        name: "MicrosoftAuthError",
        kind: "refresh_failed",
      })
    );
    try {
      await microsoftExcelAdapter.syncInstance!(INSTANCE as never, "user-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("AADSTS70008");
    }
    // Sync did not complete — must not flip lastSyncAt.
    expect(updateInstanceMock).not.toHaveBeenCalled();
  });

  it("sums per-entity reap counts across multiple connectorEntityIds", async () => {
    findCurrentByConnectorInstanceIdMock.mockResolvedValue({
      id: "plan-1",
      plan: {},
    });
    fetchWorkbookForSyncMock.mockResolvedValue({ sheets: [] });
    commitMock.mockResolvedValue({
      recordCounts: { created: 0, updated: 0, unchanged: 0 },
      connectorEntityIds: ["ce-a", "ce-b", "ce-c"],
    });
    softDeleteBeforeWatermarkMock.mockResolvedValueOnce(5);
    softDeleteBeforeWatermarkMock.mockResolvedValueOnce(3);
    softDeleteBeforeWatermarkMock.mockResolvedValueOnce(2);

    const result = await microsoftExcelAdapter.syncInstance!(
      INSTANCE as never,
      "user-1"
    );
    expect(result.recordCounts.deleted).toBe(10);
  });
});
