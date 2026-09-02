import { jest } from "@jest/globals";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { JobStreamState } from "../utils/job-stream.util";

// ── Mocks ───────────────────────────────────────────────────────────

const mockMutate =
  jest.fn<
    (
      vars: undefined,
      opts: { onSuccess: (r: { jobId: string }) => void }
    ) => void
  >();

/** Every jobId `sdk.jobs.stream` was called with, in order. */
let streamCalls: Array<string | null> = [];
let currentStream: JobStreamState;
let currentRunningJobs: {
  data?: { runningJobs: Array<{ id: string; type: string }> };
};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorInstances: {
      sync: () => ({ mutate: mockMutate, isPending: false }),
      runningJobs: () => currentRunningJobs,
    },
    jobs: {
      stream: (jobId: string | null) => {
        streamCalls.push(jobId);
        return { ...currentStream, jobId };
      },
    },
  },
  queryKeys: {
    connectorInstances: {
      root: ["connectorInstances"],
      get: (id: string) => ["connectorInstances", "get", id],
    },
    entityRecords: { root: ["entityRecords"] },
    jobs: { root: ["jobs"] },
  },
}));

const { renderHook, act, waitFor } = await import("./test-utils");

/** The hook calls useQueryClient; renderHook ships without providers. */
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);
const { useConnectorInstanceSync } =
  await import("../utils/use-connector-instance-sync.util");

// ── Helpers ─────────────────────────────────────────────────────────

const idleStream = (): JobStreamState => ({
  jobId: null,
  status: null,
  progress: 0,
  progressDetail: null,
  error: null,
  result: null,
  startedAt: null,
  completedAt: null,
  connectionStatus: "idle",
});

beforeEach(() => {
  streamCalls = [];
  mockMutate.mockReset();
  currentStream = idleStream();
  currentRunningJobs = { data: { runningJobs: [] } };
});

// ── Tests (#493) ────────────────────────────────────────────────────

describe("useConnectorInstanceSync — re-latch onto a running sync", () => {
  it("seeds the stream from a running connector_sync job on mount", async () => {
    currentRunningJobs = {
      data: { runningJobs: [{ id: "job-run-1", type: "connector_sync" }] },
    };

    renderHook(() => useConnectorInstanceSync("ci-1"), { wrapper });

    await waitFor(() => {
      expect(streamCalls).toContain("job-run-1");
    });
  });

  it("ignores running jobs of other types", async () => {
    currentRunningJobs = {
      data: { runningJobs: [{ id: "job-commit", type: "layout_plan_commit" }] },
    };

    renderHook(() => useConnectorInstanceSync("ci-1"), { wrapper });

    // Let effects flush, then assert the stream was never opened.
    await act(async () => {});
    expect(streamCalls.every((id) => id === null)).toBe(true);
  });

  it("does not seed when nothing is running", async () => {
    renderHook(() => useConnectorInstanceSync("ci-1"), { wrapper });

    await act(async () => {});
    expect(streamCalls.every((id) => id === null)).toBe(true);
  });

  it("does not re-seed from stale running-jobs data after the user dismisses", async () => {
    currentRunningJobs = {
      data: { runningJobs: [{ id: "job-run-1", type: "connector_sync" }] },
    };
    const { result, rerender } = renderHook(
      () => useConnectorInstanceSync("ci-1"),
      { wrapper }
    );
    await waitFor(() => expect(streamCalls).toContain("job-run-1"));

    // The job finishes; the user dismisses the toast; the running-jobs
    // query is still stale and would hand back the same (now finished) job.
    currentStream = { ...idleStream(), status: "completed" };
    act(() => result.current.onDismissResult());
    rerender();
    await act(async () => {});

    expect(streamCalls[streamCalls.length - 1]).toBeNull();
  });

  it("never overwrites a mutation-seeded jobId with the running-jobs result", async () => {
    mockMutate.mockImplementation((_vars, opts) =>
      opts.onSuccess({ jobId: "job-mut" })
    );
    const { result, rerender } = renderHook(
      () => useConnectorInstanceSync("ci-1"),
      { wrapper }
    );

    act(() => result.current.onSync());
    await waitFor(() => expect(streamCalls).toContain("job-mut"));

    // A refetch now reports the same run under its job id — it must not
    // displace the mutation-seeded stream.
    currentRunningJobs = {
      data: { runningJobs: [{ id: "job-other", type: "connector_sync" }] },
    };
    rerender();
    await act(async () => {});

    expect(streamCalls).not.toContain("job-other");
    expect(streamCalls[streamCalls.length - 1]).toBe("job-mut");
  });
});
