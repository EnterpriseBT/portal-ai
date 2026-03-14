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
// Mock Auth0
// ---------------------------------------------------------------------------

const mockGetAccessTokenSilently = jest.fn<(...args: unknown[]) => Promise<string>>();

jest.unstable_mockModule("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mockGetAccessTokenSilently,
  }),
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

const { renderHook, act, waitFor } = await import("./test-utils");
const { useJobStream } = await import("../utils/job-stream.util");

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
    mockGetAccessTokenSilently.mockResolvedValue("test-token-123");
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

  it("should connect with correct URL and auth token", async () => {
    renderHook(() => useJobStream("job-123"));
    const es = await waitForConnection();

    expect(es.url).toBe(
      "/api/sse/jobs/job-123/events?token=test-token-123"
    );
    // Verify token was requested with authorizationParams
    // (audience comes from import.meta.env which is undefined in Jest)
    expect(mockGetAccessTokenSilently).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationParams: expect.any(Object) })
    );
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

    mockGetAccessTokenSilently.mockResolvedValue("test-token-123");
    const { result } = renderHook(() => useJobStream("job-123"));

    // Flush async openStream (token fetch is a microtask)
    await act(async () => { });

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
    await act(async () => { });

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

  it("should handle token fetch error gracefully", async () => {
    mockGetAccessTokenSilently.mockRejectedValueOnce(
      new Error("Auth failed")
    );

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
