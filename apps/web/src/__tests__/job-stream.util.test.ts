import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock EventSource (not provided by jsdom)
// ---------------------------------------------------------------------------

type ESListener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  static lastInstance: MockEventSource | null = null;

  url: string;
  close: jest.Mock;
  onerror: ((event: Event) => void) | null = null;

  private _listeners = new Map<string, ESListener[]>();

  constructor(url: string) {
    this.url = url;
    this.close = jest.fn();
    MockEventSource.instances.push(this);
    MockEventSource.lastInstance = this;
  }

  addEventListener(type: string, listener: ESListener) {
    const list = this._listeners.get(type) || [];
    list.push(listener);
    this._listeners.set(type, list);
  }

  removeEventListener(type: string, listener: ESListener) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      list.filter((l) => l !== listener)
    );
  }

  // --- Test helpers ---

  __emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this._listeners.get(type)?.forEach((fn) => fn(event));
  }

  __emitError() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    MockEventSource.instances = [];
    MockEventSource.lastInstance = null;
  }
}

Object.defineProperty(globalThis, "EventSource", {
  value: MockEventSource,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Mock SSE SDK (sse.create() is a hook that returns an async connect fn)
// ---------------------------------------------------------------------------

const mockConnect = jest.fn<(path: string) => Promise<MockEventSource>>();

jest.unstable_mockModule("../api/sse.api", () => ({
  sse: {
    create: () => mockConnect,
  },
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

const { renderHook, act, waitFor } = await import("./test-utils");
const { useJobStream, awaitJobCompletion } =
  await import("../utils/job-stream.util");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SNAPSHOT_ACTIVE = {
  jobId: "job-123",
  status: "active",
  progress: 25,
  error: null,
  result: null,
  startedAt: 1000,
  completedAt: null,
};

/** Wait until an EventSource has been created. */
const waitForConnection = async () => {
  await waitFor(() => {
    expect(MockEventSource.lastInstance).not.toBeNull();
  });
  return MockEventSource.lastInstance!;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useJobStream", () => {
  beforeEach(() => {
    MockEventSource.reset();
    mockConnect.mockImplementation(async (path: string) => {
      const es = new MockEventSource(`https://api.test.com${path}`);
      return es;
    });
  });

  // --- Idle / disabled ---

  it("should return initial state when jobId is null", () => {
    const { result } = renderHook(() => useJobStream(null));

    expect(result.current).toEqual({
      jobId: null,
      status: null,
      progress: 0,
      error: null,
      result: null,
      startedAt: null,
      completedAt: null,
      connectionStatus: "idle",
    });
  });

  it("should return initial state when jobId is undefined", () => {
    const { result } = renderHook(() => useJobStream(undefined));

    expect(result.current.connectionStatus).toBe("idle");
  });

  // --- Connection ---

  it("should connect with correct path via SDK", async () => {
    renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    expect(mockConnect).toHaveBeenCalledWith("/api/sse/jobs/job-123/events");
    expect(es.url).toBe("https://api.test.com/api/sse/jobs/job-123/events");
  });

  it("should URL-encode the jobId", async () => {
    renderHook(() => useJobStream("job/with spaces"));
    const es = await waitForConnection();

    expect(es.url).toContain("job%2Fwith%20spaces");
  });

  it("should show connecting status before snapshot", () => {
    const { result } = renderHook(() => useJobStream("job-123"));

    expect(result.current.connectionStatus).toBe("connecting");
  });

  // --- Snapshot event ---

  it("should handle snapshot event and set initial state", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => {
      es.__emit("snapshot", SNAPSHOT_ACTIVE);
    });

    expect(result.current).toEqual({
      jobId: "job-123",
      status: "active",
      progress: 25,
      error: null,
      result: null,
      startedAt: 1000,
      completedAt: null,
      connectionStatus: "connected",
    });
  });

  it("should close on terminal snapshot", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => {
      es.__emit("snapshot", {
        jobId: "job-123",
        status: "completed",
        progress: 100,
        error: null,
        result: { recordsSynced: 42 },
        startedAt: 1000,
        completedAt: 2000,
      });
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.connectionStatus).toBe("closed");
    expect(result.current.status).toBe("completed");
    expect(result.current.result).toEqual({ recordsSynced: 42 });
  });

  // --- Update event ---

  it("should merge live update into state", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => es.__emit("snapshot", SNAPSHOT_ACTIVE));

    act(() => {
      es.__emit("update", {
        jobId: "job-123",
        status: "active",
        progress: 75,
        timestamp: 2000,
      });
    });

    expect(result.current.progress).toBe(75);
    expect(result.current.connectionStatus).toBe("connected");
  });

  it("should close on terminal update (failed)", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => es.__emit("snapshot", SNAPSHOT_ACTIVE));

    act(() => {
      es.__emit("update", {
        jobId: "job-123",
        status: "failed",
        progress: 25,
        error: "Something broke",
        timestamp: 3000,
      });
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.connectionStatus).toBe("closed");
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("Something broke");
  });

  it("should close on terminal update (cancelled)", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => es.__emit("snapshot", SNAPSHOT_ACTIVE));

    act(() => {
      es.__emit("update", {
        jobId: "job-123",
        status: "cancelled",
        progress: 25,
        timestamp: 3000,
      });
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.connectionStatus).toBe("closed");
  });

  it("should preserve previous error when update omits it", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => {
      es.__emit("snapshot", { ...SNAPSHOT_ACTIVE, error: "partial error" });
    });

    act(() => {
      es.__emit("update", {
        jobId: "job-123",
        status: "active",
        progress: 75,
        timestamp: 2000,
      });
    });

    expect(result.current.error).toBe("partial error");
    expect(result.current.progress).toBe(75);
  });

  // --- Error / reconnect ---

  it("should set error status on EventSource error", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => es.__emit("snapshot", SNAPSHOT_ACTIVE));
    act(() => es.__emitError());

    expect(result.current.connectionStatus).toBe("error");
  });

  it("should auto-reconnect after error when not terminal", async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useJobStream("job-123"));

    // Flush async openStream (token fetch is a microtask)
    await act(async () => {});

    expect(MockEventSource.lastInstance).not.toBeNull();
    const es = MockEventSource.lastInstance!;

    act(() => es.__emit("snapshot", SNAPSHOT_ACTIVE));
    act(() => es.__emitError());

    expect(result.current.connectionStatus).toBe("error");

    // Advance past RECONNECT_DELAY_MS (3000)
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    // Flush microtasks from the new openStream call
    await act(async () => {});

    expect(MockEventSource.instances.length).toBe(2);

    jest.useRealTimers();
  });

  it("should not reconnect when job is already terminal", async () => {
    const { result } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    act(() => {
      es.__emit("snapshot", {
        ...SNAPSHOT_ACTIVE,
        status: "completed",
        progress: 100,
      });
    });

    // EventSource was already closed by terminal snapshot
    expect(es.close).toHaveBeenCalled();
    expect(result.current.connectionStatus).toBe("closed");
  });

  it("should handle connection error gracefully", async () => {
    mockConnect.mockRejectedValueOnce(new Error("Auth failed"));

    const { result } = renderHook(() => useJobStream("job-123"));

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe("error");
    });

    expect(MockEventSource.instances).toHaveLength(0);
  });

  // --- Cleanup ---

  it("should close EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    unmount();

    expect(es.close).toHaveBeenCalled();
  });

  it("should close previous EventSource when jobId changes", async () => {
    const { rerender } = renderHook(
      ({ jobId }: { jobId: string | null }) => useJobStream(jobId),
      { initialProps: { jobId: "job-1" } }
    );

    const es1 = await waitForConnection();

    rerender({ jobId: "job-2" });

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(2);
    });

    expect(es1.close).toHaveBeenCalled();
    expect(MockEventSource.lastInstance!.url).toContain("job-2");
  });

  // --- Browser refresh recovery ---

  it("should recover state via snapshot on reconnect (browser refresh)", async () => {
    const { result, rerender } = renderHook(
      ({ jobId }: { jobId: string | null }) => useJobStream(jobId),
      { initialProps: { jobId: "job-123" as string | null } }
    );

    const es1 = await waitForConnection();

    // First connection: job is active at 50%
    act(() => {
      es1.__emit("snapshot", {
        ...SNAPSHOT_ACTIVE,
        progress: 50,
      });
    });

    expect(result.current.progress).toBe(50);

    // Simulate "refresh" — unmount and remount with same jobId
    rerender({ jobId: null });
    rerender({ jobId: "job-123" });

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(1);
    });

    const es2 = MockEventSource.lastInstance!;

    // Reconnected: snapshot shows job progressed to 80% while disconnected
    act(() => {
      es2.__emit("snapshot", {
        ...SNAPSHOT_ACTIVE,
        progress: 80,
      });
    });

    expect(result.current.progress).toBe(80);
    expect(result.current.connectionStatus).toBe("connected");
  });
});

// ---------------------------------------------------------------------------
// awaitJobCompletion (imperative variant)
// ---------------------------------------------------------------------------

describe("awaitJobCompletion", () => {
  beforeEach(() => {
    MockEventSource.reset();
    mockConnect.mockImplementation(async (path: string) => {
      const es = new MockEventSource(`https://api.test.com${path}`);
      return es;
    });
  });

  it("resolves with the job result when an update event reports `completed`", async () => {
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-1"
    );
    const es = await waitForConnection();

    es.__emit("update", {
      jobId: "job-1",
      status: "completed",
      progress: 100,
      result: { uploadSessionId: "sess-1", sheets: [], sliced: false },
    });

    await expect(promise).resolves.toEqual({
      result: { uploadSessionId: "sess-1", sheets: [], sliced: false },
    });
    expect(es.close).toHaveBeenCalled();
  });

  it("resolves immediately when the snapshot already shows `completed`", async () => {
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-1"
    );
    const es = await waitForConnection();

    es.__emit("snapshot", {
      jobId: "job-1",
      status: "completed",
      progress: 100,
      error: null,
      result: { uploadSessionId: "sess-1", sheets: [{ id: "s_0_x" }] },
      startedAt: 0,
      completedAt: 0,
    });

    await expect(promise).resolves.toEqual({
      result: { uploadSessionId: "sess-1", sheets: [{ id: "s_0_x" }] },
    });
  });

  it("rejects with the job's error string when `failed`", async () => {
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-2"
    );
    const es = await waitForConnection();

    es.__emit("update", {
      jobId: "job-2",
      status: "failed",
      progress: 50,
      error: "Upload xyz belongs to a different organization",
    });

    await expect(promise).rejects.toThrow(
      "Upload xyz belongs to a different organization"
    );
    expect(es.close).toHaveBeenCalled();
  });

  it("rejects on `cancelled` status", async () => {
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-3"
    );
    const es = await waitForConnection();

    es.__emit("update", {
      jobId: "job-3",
      status: "cancelled",
      progress: 30,
    });

    await expect(promise).rejects.toThrow("Job cancelled");
  });

  it("ignores progress events while still active", async () => {
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-4"
    );
    const es = await waitForConnection();

    es.__emit("update", { jobId: "job-4", status: "active", progress: 25 });
    es.__emit("update", { jobId: "job-4", status: "active", progress: 60 });
    expect(es.close).not.toHaveBeenCalled();

    es.__emit("update", {
      jobId: "job-4",
      status: "completed",
      progress: 100,
      result: { uploadSessionId: "sess-4", sheets: [] },
    });

    await expect(promise).resolves.toEqual({
      result: { uploadSessionId: "sess-4", sheets: [] },
    });
  });

  it("rejects with AbortError + closes the EventSource when the signal aborts", async () => {
    const ac = new AbortController();
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-5",
      {
        signal: ac.signal,
      }
    );
    const es = await waitForConnection();

    ac.abort();

    await expect(promise).rejects.toThrow(/aborted/i);
    expect(es.close).toHaveBeenCalled();
  });

  it("rejects when the SSE connection errors before completion", async () => {
    const promise = awaitJobCompletion(
      mockConnect as unknown as (path: string) => Promise<EventSource>,
      "job-6"
    );
    const es = await waitForConnection();

    es.__emitError();

    await expect(promise).rejects.toThrow(/SSE connection error/i);
  });
});
