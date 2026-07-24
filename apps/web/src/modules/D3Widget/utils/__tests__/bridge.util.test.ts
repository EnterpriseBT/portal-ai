import { jest } from "@jest/globals";

import {
  BRIDGE_PROTOCOL_VERSION,
  RENDER_TIMEOUT_MS,
  createSandboxBridge,
  type SandboxBridgeCallbacks,
} from "../bridge.util";
import type { D3SandboxTheme } from "../sandbox-theme.util";

const THEME: D3SandboxTheme = {
  mode: "light",
  background: "#ffffff",
  text: "#1a1630",
  fontFamily: "sans-serif",
  monospaceFontFamily: "monospace",
  categorical: ["#111111", "#222222"],
};

const INIT = {
  program: "api.d3.select(api.container);",
  params: { highlight: "Feb" },
  theme: THEME,
  size: { width: 640, height: 360 },
};

interface PostedMessage {
  v: number;
  nonce: string;
  type: string;
  [key: string]: unknown;
}

const makeIframe = () => {
  const postMessage = jest.fn();
  const iframe = {
    contentWindow: { postMessage },
  } as unknown as HTMLIFrameElement;
  const posted = (): PostedMessage[] =>
    postMessage.mock.calls.map((c) => c[0] as PostedMessage);
  return { iframe, posted };
};

const makeCallbacks = (): SandboxBridgeCallbacks => ({
  onRendered: jest.fn(),
  onResize: jest.fn(),
  onError: jest.fn(),
});

/** Dispatch a window message as if it came from the given frame. */
const frameMessage = (
  iframe: HTMLIFrameElement,
  data: unknown,
  source: unknown = iframe.contentWindow
) => {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: source as Window | null })
  );
};

const READY = { v: BRIDGE_PROTOCOL_VERSION, nonce: null, type: "ready" };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createSandboxBridge — init handshake", () => {
  it("sends init (with a fresh nonce) only after the frame's ready message", () => {
    const { iframe, posted } = makeIframe();
    const bridge = createSandboxBridge(iframe, INIT, makeCallbacks());

    expect(posted()).toHaveLength(0);
    frameMessage(iframe, READY);

    const messages = posted();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      v: BRIDGE_PROTOCOL_VERSION,
      type: "init",
      program: INIT.program,
      params: INIT.params,
      theme: THEME,
      size: INIT.size,
    });
    expect(typeof messages[0].nonce).toBe("string");
    expect(messages[0].nonce.length).toBeGreaterThan(0);
    bridge.dispose();
  });

  it("ignores a ready message from a different source", () => {
    const { iframe, posted } = makeIframe();
    const bridge = createSandboxBridge(iframe, INIT, makeCallbacks());

    frameMessage(iframe, READY, window);
    expect(posted()).toHaveLength(0);
    bridge.dispose();
  });
});

describe("createSandboxBridge — outbound sends", () => {
  it("posts data batches with the bridge nonce, preserving call order", () => {
    const { iframe, posted } = makeIframe();
    const bridge = createSandboxBridge(iframe, INIT, makeCallbacks());
    frameMessage(iframe, READY);
    const nonce = posted()[0].nonce;

    bridge.sendData([{ x: 1 }], 0, false);
    bridge.sendData([{ x: 2 }], 1, true);

    const dataMessages = posted().filter((m) => m.type === "data");
    expect(dataMessages).toEqual([
      { v: 1, nonce, type: "data", rows: [{ x: 1 }], seq: 0, done: false },
      { v: 1, nonce, type: "data", rows: [{ x: 2 }], seq: 1, done: true },
    ]);
    bridge.dispose();
  });

  it("queues sends issued before ready and flushes them after init", () => {
    const { iframe, posted } = makeIframe();
    const bridge = createSandboxBridge(iframe, INIT, makeCallbacks());

    bridge.sendData([{ x: 1 }], 0, true);
    expect(posted()).toHaveLength(0);

    frameMessage(iframe, READY);
    const types = posted().map((m) => m.type);
    expect(types).toEqual(["init", "data"]);
    bridge.dispose();
  });
});

describe("createSandboxBridge — inbound dispatch", () => {
  const settle = (iframe: HTMLIFrameElement, posted: () => PostedMessage[]) => {
    frameMessage(iframe, READY);
    return posted()[0].nonce;
  };

  it("dispatches rendered / resize / error to the matching callbacks", () => {
    const { iframe, posted } = makeIframe();
    const callbacks = makeCallbacks();
    const bridge = createSandboxBridge(iframe, INIT, callbacks);
    const nonce = settle(iframe, posted);

    frameMessage(iframe, {
      v: 1,
      nonce,
      type: "rendered",
      height: 240,
      rowCount: 12,
    });
    frameMessage(iframe, { v: 1, nonce, type: "resize", height: 300 });
    frameMessage(iframe, {
      v: 1,
      nonce,
      type: "error",
      message: "boom",
      stack: "at x",
    });

    expect(callbacks.onRendered).toHaveBeenCalledWith({
      height: 240,
      rowCount: 12,
    });
    expect(callbacks.onResize).toHaveBeenCalledWith({ height: 300 });
    expect(callbacks.onError).toHaveBeenCalledWith({
      message: "boom",
      stack: "at x",
    });
    bridge.dispose();
  });

  it("drops messages with a wrong nonce or malformed payload", () => {
    const { iframe, posted } = makeIframe();
    const callbacks = makeCallbacks();
    const bridge = createSandboxBridge(iframe, INIT, callbacks);
    const nonce = settle(iframe, posted);

    frameMessage(iframe, {
      v: 1,
      nonce: "wrong",
      type: "rendered",
      height: 1,
      rowCount: 1,
    });
    frameMessage(iframe, { v: 1, nonce, type: "rendered", height: "tall" });
    frameMessage(iframe, "not-an-object");

    expect(callbacks.onRendered).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    bridge.dispose();
  });
});

describe("createSandboxBridge — render watchdog", () => {
  it("fires onError when nothing renders within RENDER_TIMEOUT_MS (even without ready)", () => {
    const { iframe } = makeIframe();
    const callbacks = makeCallbacks();
    const bridge = createSandboxBridge(iframe, INIT, callbacks);

    jest.advanceTimersByTime(RENDER_TIMEOUT_MS);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect((callbacks.onError as jest.Mock).mock.calls[0][0]).toMatchObject({
      message: expect.stringContaining("render"),
    });
    bridge.dispose();
  });

  it("is cancelled by the first rendered message", () => {
    const { iframe, posted } = makeIframe();
    const callbacks = makeCallbacks();
    const bridge = createSandboxBridge(iframe, INIT, callbacks);
    frameMessage(iframe, READY);
    const nonce = posted()[0].nonce;

    frameMessage(iframe, {
      v: 1,
      nonce,
      type: "rendered",
      height: 100,
      rowCount: 5,
    });
    jest.advanceTimersByTime(RENDER_TIMEOUT_MS * 2);
    expect(callbacks.onError).not.toHaveBeenCalled();
    bridge.dispose();
  });
});

describe("createSandboxBridge — dispose", () => {
  it("stops listening and cancels the watchdog", () => {
    const { iframe, posted } = makeIframe();
    const callbacks = makeCallbacks();
    const bridge = createSandboxBridge(iframe, INIT, callbacks);
    frameMessage(iframe, READY);
    const nonce = posted()[0].nonce;

    bridge.dispose();

    frameMessage(iframe, {
      v: 1,
      nonce,
      type: "rendered",
      height: 100,
      rowCount: 5,
    });
    jest.advanceTimersByTime(RENDER_TIMEOUT_MS * 2);
    expect(callbacks.onRendered).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
