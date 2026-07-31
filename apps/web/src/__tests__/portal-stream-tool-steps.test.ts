import { jest } from "@jest/globals";

// #279 — in-flight tool step tracking in usePortalStream.
//
// `tool_call` opens a step, `tool_call_end` closes it by id, and every
// terminal path clears the set. The active step is the LAST element: a turn
// can have several tools open at once, the newest is what the user is shown,
// and closing it must fall back to the next still-open step rather than
// blanking the indicator.
//
// The pre-existing portal-stream test covers only the pure `streamingBlockFor`
// mapper, so driving the hook's listeners needs a capturable EventSource.

import {
  MockEventSource,
  installMockEventSource,
} from "./__mocks__/mock-event-source";

installMockEventSource();

const mockConnect = jest.fn<(path: string) => Promise<MockEventSource>>();

jest.unstable_mockModule("../api/sse.api", () => ({
  sse: { create: () => mockConnect },
}));

const { renderHook, act, waitFor } = await import("./test-utils");
const { usePortalStream } = await import("../utils/portal-stream.util");

const PORTAL_ID = "portal-1";

const call = (toolCallId: string, toolName: string) => ({
  type: "tool_call",
  toolCallId,
  toolName,
});

const callEnd = (toolCallId: string, toolName: string) => ({
  type: "tool_call_end",
  toolCallId,
  toolName,
});

describe("usePortalStream — tool step tracking (#279)", () => {
  beforeEach(() => {
    MockEventSource.reset();
    mockConnect.mockImplementation(
      async (path: string) => new MockEventSource(`https://api.test.com${path}`)
    );
  });

  /** Render the hook and open the stream, returning the harness + the ES. */
  const startStream = async () => {
    const harness = renderHook(() => usePortalStream());
    await act(async () => {
      await harness.result.current[1].send(PORTAL_ID);
    });
    await waitFor(() => {
      expect(MockEventSource.lastInstance).not.toBeNull();
    });
    return { harness, es: MockEventSource.lastInstance! };
  };

  /** Last element — apps/web targets ES2020, so `Array.prototype.at` is not
   *  available to the type checker. */
  const last = <T>(items: T[]): T | undefined => items[items.length - 1];

  it("starts with no open steps", async () => {
    const { harness } = await startStream();
    expect(harness.result.current[0].toolSteps).toEqual([]);
  });

  it("opens a step on tool_call with the tool name and a start time", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));

    const open = harness.result.current[0].toolSteps;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      toolCallId: "tc-1",
      toolName: "sql_query",
    });
    expect(typeof open[0]!.startedAt).toBe("number");
    expect(open[0]!.startedAt).toBeGreaterThan(0);
  });

  it("keeps the most recently started step last", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() => es.__emit("tool_call", call("tc-2", "visualize_d3")));

    const open = harness.result.current[0].toolSteps;
    expect(open.map((s) => s.toolCallId)).toEqual(["tc-1", "tc-2"]);
    expect(last(open)!.toolName).toBe("visualize_d3");
  });

  it("falls back to the next open step when the newest closes", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() => es.__emit("tool_call", call("tc-2", "visualize_d3")));
    act(() => es.__emit("tool_call_end", callEnd("tc-2", "visualize_d3")));

    const open = harness.result.current[0].toolSteps;
    expect(open).toHaveLength(1);
    expect(last(open)!.toolName).toBe("sql_query");
  });

  it("closes a step on tool_call_end", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "hypothesis_test")));
    act(() => es.__emit("tool_call_end", callEnd("tc-1", "hypothesis_test")));

    expect(harness.result.current[0].toolSteps).toEqual([]);
  });

  it("ignores tool_call_end for an unknown id", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() => es.__emit("tool_call_end", callEnd("tc-999", "sql_query")));

    expect(harness.result.current[0].toolSteps).toHaveLength(1);
  });

  it("does not duplicate a step when the same id opens twice", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));

    expect(harness.result.current[0].toolSteps).toHaveLength(1);
  });

  // Four independent terminal paths. Nothing may outlive a turn — a lingering
  // step would leave the indicator naming a tool that already stopped.
  it("clears open steps on done", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() =>
      es.__emit("done", {
        type: "done",
        portalId: PORTAL_ID,
        messageId: "m-1",
      })
    );

    expect(harness.result.current[0].toolSteps).toEqual([]);
  });

  it("clears open steps on stream_error", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() =>
      es.__emit("stream_error", { type: "stream_error", message: "boom" })
    );

    expect(harness.result.current[0].toolSteps).toEqual([]);
    expect(harness.result.current[0].streamError).toBe("boom");
  });

  it("clears open steps on connection loss", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() => es.__emitError());

    expect(harness.result.current[0].toolSteps).toEqual([]);
  });

  it("clears open steps on cancel", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "visualize_d3")));
    act(() => harness.result.current[1].cancel());

    expect(harness.result.current[0].toolSteps).toEqual([]);
  });

  it("starts a fresh turn with no steps carried over", async () => {
    const { harness, es } = await startStream();

    act(() => es.__emit("tool_call", call("tc-1", "sql_query")));
    act(() => harness.result.current[1].cancel());

    await act(async () => {
      await harness.result.current[1].send(PORTAL_ID);
    });

    expect(harness.result.current[0].toolSteps).toEqual([]);
  });
});
