import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

const mockPortalsFindById =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPortalMessagesCreate =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRedisPublish = jest.fn<() => Promise<number>>().mockResolvedValue(1);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      portals: { findById: mockPortalsFindById },
      portalMessages: { create: mockPortalMessagesCreate },
    },
  },
}));

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    publish: mockRedisPublish,
  }),
}));

jest.unstable_mockModule("../../utils/system.util.js", () => ({
  SystemUtilities: {
    utc: {
      now: () => ({ getTime: () => 1_700_000_000_000 }),
    },
    id: {
      v4: { generate: () => "msg-generated-1" },
    },
  },
}));

const { PortalService, PORTAL_EVENTS_CHANNEL_PREFIX } = await import(
  "../../services/portal.service.js"
);

beforeEach(() => {
  jest.clearAllMocks();
  mockPortalsFindById.mockResolvedValue({
    id: "portal-1",
    organizationId: "org-1",
    createdBy: "user-1",
  });
  mockPortalMessagesCreate.mockResolvedValue({ id: "msg-1" });
});

describe("PortalService.notifyJobTerminal", () => {
  it("persists a template assistant message with text summary on completed", async () => {
    await PortalService.notifyJobTerminal("portal-1", "job-1", {
      status: "completed",
      recordsProcessed: 100,
      recordsFailed: 0,
      durationMs: 3_000,
    });

    expect(mockPortalMessagesCreate).toHaveBeenCalledTimes(1);
    const persisted = mockPortalMessagesCreate.mock.calls[0][0] as {
      role: string;
      blocks: Array<{ type: string; content: unknown }>;
    };
    expect(persisted.role).toBe("assistant");
    expect(persisted.blocks).toHaveLength(1);
    expect(persisted.blocks[0].type).toBe("text");
    expect((persisted.blocks[0].content as string)).toMatch(/100 records/);
  });

  it("includes a bulk-failures-table block when partialFailures is non-empty", async () => {
    await PortalService.notifyJobTerminal("portal-1", "job-1", {
      status: "completed",
      recordsProcessed: 97,
      recordsFailed: 3,
      durationMs: 5_000,
      partialFailures: [
        {
          sourceKey: "p-99",
          error: { code: "TOOL_TIMEOUT", message: "Timed out" },
        },
      ],
    });

    const persisted = mockPortalMessagesCreate.mock.calls[0][0] as {
      blocks: Array<{ type: string; content: unknown }>;
    };
    expect(persisted.blocks).toHaveLength(2);
    expect(persisted.blocks[1].type).toBe("bulk-failures-table");
    const failuresContent = persisted.blocks[1].content as {
      jobId: string;
      failures: Array<{ sourceKey: string }>;
    };
    expect(failuresContent.jobId).toBe("job-1");
    expect(failuresContent.failures[0].sourceKey).toBe("p-99");
  });

  it("emits a cancelled-status text when status is cancelled", async () => {
    await PortalService.notifyJobTerminal("portal-1", "job-1", {
      status: "cancelled",
      recordsProcessed: 47,
      recordsFailed: 0,
      durationMs: 1_000,
    });
    const persisted = mockPortalMessagesCreate.mock.calls[0][0] as {
      blocks: Array<{ content: string }>;
    };
    expect(persisted.blocks[0].content).toMatch(/Cancelled at 47/);
  });

  it("emits a failed-status text including the error message when status is failed", async () => {
    await PortalService.notifyJobTerminal("portal-1", "job-1", {
      status: "failed",
      recordsProcessed: 0,
      recordsFailed: 0,
      durationMs: 100,
      errorMessage: "syntax error at AS",
    });
    const persisted = mockPortalMessagesCreate.mock.calls[0][0] as {
      blocks: Array<{ content: string }>;
    };
    expect(persisted.blocks[0].content).toMatch(/Failed: syntax error/);
  });

  it("publishes a bulk_job_terminal event on the portal-events channel", async () => {
    await PortalService.notifyJobTerminal("portal-1", "job-1", {
      status: "completed",
      recordsProcessed: 10,
      recordsFailed: 0,
      durationMs: 50,
    });
    expect(mockRedisPublish).toHaveBeenCalledTimes(1);
    const [channel, payloadStr] = mockRedisPublish.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(channel).toBe(`${PORTAL_EVENTS_CHANNEL_PREFIX}portal-1`);
    const parsed = JSON.parse(payloadStr);
    expect(parsed.type).toBe("bulk_job_terminal");
    expect(parsed.jobId).toBe("job-1");
    expect(parsed.status).toBe("completed");
  });

  it("skips when the portal isn't found (best-effort hook)", async () => {
    mockPortalsFindById.mockResolvedValueOnce(undefined);
    await PortalService.notifyJobTerminal("portal-missing", "job-1", {
      status: "completed",
      recordsProcessed: 10,
      recordsFailed: 0,
      durationMs: 50,
    });
    expect(mockPortalMessagesCreate).not.toHaveBeenCalled();
    expect(mockRedisPublish).not.toHaveBeenCalled();
  });
});
