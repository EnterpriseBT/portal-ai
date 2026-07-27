import { jest } from "@jest/globals";
import { act, render } from "@testing-library/react";

import type { D3SandboxTheme } from "../utils/sandbox-theme.util";
import type {
  SandboxBridge,
  SandboxBridgeCallbacks,
  SandboxBridgeInit,
} from "../utils/bridge.util";

// ── Bridge mock (behavior is covered by bridge.util tests) ──────────

const bridge = {
  sendData: jest.fn(),
  sendTheme: jest.fn(),
  sendResize: jest.fn(),
  dispose: jest.fn(),
};
const createSandboxBridge =
  jest.fn<
    (
      iframe: HTMLIFrameElement,
      init: SandboxBridgeInit,
      callbacks: SandboxBridgeCallbacks
    ) => SandboxBridge
  >();

jest.unstable_mockModule("../utils/bridge.util", () => ({
  createSandboxBridge,
}));

const { D3SandboxFrameUI } = await import("../D3SandboxFrame.component");
const { SANDBOX_SRCDOC } = await import("../utils/sandbox-srcdoc.util");

// ── Fixtures ─────────────────────────────────────────────────────────

const THEME: D3SandboxTheme = {
  mode: "light",
  background: "#fff",
  text: "#111",
  fontFamily: "sans-serif",
  monospaceFontFamily: "monospace",
  categorical: ["#123456"],
};

const baseProps = {
  program: "api.d3.select(api.container);",
  params: { p: 1 },
  theme: THEME,
  batches: [{ rows: [{ x: 1 }], seq: 0, done: false }],
  onError: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  createSandboxBridge.mockReturnValue(bridge as unknown as SandboxBridge);
});

// ── Tests (spec case 20 + bridge lifecycle wiring) ───────────────────

describe("D3SandboxFrameUI", () => {
  it("renders an iframe sandboxed to exactly allow-scripts with the shared srcdoc", () => {
    const { container } = render(<D3SandboxFrameUI {...baseProps} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("srcDoc") ?? iframe.srcdoc).toBe(SANDBOX_SRCDOC);
    expect(iframe.getAttribute("title")).toBeTruthy();
  });

  it("creates the bridge with the program/params/theme and forwards initial batches", () => {
    render(<D3SandboxFrameUI {...baseProps} />);
    expect(createSandboxBridge).toHaveBeenCalledTimes(1);
    const [iframeArg, initArg] = createSandboxBridge.mock.calls[0];
    expect(iframeArg).toBeInstanceOf(HTMLIFrameElement);
    expect(initArg).toMatchObject({
      program: baseProps.program,
      params: baseProps.params,
      theme: THEME,
    });
    expect(bridge.sendData).toHaveBeenCalledTimes(1);
    expect(bridge.sendData).toHaveBeenCalledWith([{ x: 1 }], 0, false);
  });

  it("forwards only newly arrived batches on re-render", () => {
    const { rerender } = render(<D3SandboxFrameUI {...baseProps} />);
    expect(bridge.sendData).toHaveBeenCalledTimes(1);

    rerender(
      <D3SandboxFrameUI
        {...baseProps}
        batches={[
          ...baseProps.batches,
          { rows: [{ x: 2 }], seq: 1, done: true },
        ]}
      />
    );
    expect(bridge.sendData).toHaveBeenCalledTimes(2);
    expect(bridge.sendData).toHaveBeenLastCalledWith([{ x: 2 }], 1, true);
  });

  it("disposes the bridge on unmount", () => {
    const { unmount } = render(<D3SandboxFrameUI {...baseProps} />);
    unmount();
    expect(bridge.dispose).toHaveBeenCalledTimes(1);
  });
});

// ── Sizing from the reported painted extent (#278, spec cases 12–14) ──

describe("D3SandboxFrameUI — frame sizing", () => {
  /** Drive the bridge callbacks the way the real frame would. */
  const callbacks = (): SandboxBridgeCallbacks =>
    createSandboxBridge.mock.calls[0][2];

  /** The chart-area wrapper the real host renders around the frame. */
  const withContainer = (width: number) => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: width,
    });
    document.body.appendChild(host);
    return host;
  };

  it("grows to the painted width when the content is wider than its container", () => {
    const container = withContainer(800);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10, width: 1_600 });
    });

    expect(iframe.style.width).toBe("1600px");
    // …but never narrower than the column it sits in.
    expect(iframe.style.minWidth).toBe("100%");
  });

  it("stays at container width when the painted content is narrower", () => {
    const container = withContainer(800);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10, width: 300 });
    });

    expect(iframe.style.width).toBe("800px");
  });

  it("takes the painted height with no vertical limit and no vertical scroller", () => {
    const container = withContainer(800);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    act(() => {
      callbacks().onRendered({ height: 2_400, rowCount: 10, width: 700 });
    });

    expect(iframe.style.height).toBe("2400px");
    expect(iframe.style.maxHeight).toBe("");
    expect(iframe.style.overflowY).toBe("");
  });

  it("applies a later resize report the same way", () => {
    const container = withContainer(800);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10, width: 700 });
    });
    act(() => {
      callbacks().onResize({ height: 900, width: 1_200 });
    });

    expect(iframe.style.height).toBe("900px");
    expect(iframe.style.width).toBe("1200px");
  });

  it("falls back to container width when the frame reports no width", () => {
    const container = withContainer(500);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10 });
    });

    expect(iframe.style.width).toBe("500px");
    expect(iframe.style.height).toBe("400px");
  });
});

// ── Responsive available width (#278, spec cases 15–18) ───────────────

describe("D3SandboxFrameUI — responsive reflow", () => {
  interface FakeRO {
    cb: ResizeObserverCallback;
    target?: Element;
    disconnect: jest.Mock;
  }
  let observers: FakeRO[] = [];
  const originalRO = global.ResizeObserver;
  const originalRaf = global.requestAnimationFrame;
  let frameQueue: FrameRequestCallback[] = [];

  class MockResizeObserver {
    cb: ResizeObserverCallback;
    target?: Element;
    observe = jest.fn((target: Element) => {
      this.target = target;
    });
    unobserve = jest.fn();
    disconnect = jest.fn();
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      observers.push(this as unknown as FakeRO);
    }
  }

  /** The wrapper the host renders around the frame, with a settable width. */
  const withContainer = (width: number) => {
    const host = document.createElement("div");
    let current = width;
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      get: () => current,
    });
    document.body.appendChild(host);
    return {
      host,
      setWidth: (next: number) => {
        current = next;
      },
    };
  };

  const callbacks = (): SandboxBridgeCallbacks =>
    createSandboxBridge.mock.calls[0][2];

  /** Fire the observer, then run the frame it scheduled. */
  const fireResize = () => {
    act(() => {
      observers[observers.length - 1]?.cb([], {} as ResizeObserver);
    });
    act(() => {
      for (const cb of frameQueue.splice(0)) cb(0);
    });
  };

  beforeEach(() => {
    observers = [];
    frameQueue = [];
    global.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frameQueue.push(cb);
      return frameQueue.length;
    }) as typeof global.requestAnimationFrame;
  });

  afterEach(() => {
    global.ResizeObserver = originalRO;
    global.requestAnimationFrame = originalRaf;
  });

  it("observes the wrapper, not the iframe — the iframe cannot widen its own container", () => {
    const { host } = withContainer(800);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container: host,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    expect(observers).toHaveLength(1);
    expect(observers[0].target).toBe(host);
    expect(observers[0].target).not.toBe(iframe);
  });

  it("sends the container width and a CONSTANT suggested height on resize", () => {
    const { host, setWidth } = withContainer(800);
    render(<D3SandboxFrameUI {...baseProps} />, { container: host });

    // A tall render happens first, so a naive implementation would echo the
    // painted height back as the new suggestion and ratchet.
    act(() => {
      callbacks().onRendered({ height: 2_000, rowCount: 10, width: 900 });
    });

    setWidth(500);
    fireResize();

    expect(bridge.sendResize).toHaveBeenCalledTimes(1);
    expect(bridge.sendResize).toHaveBeenCalledWith({ width: 500, height: 360 });
  });

  it("reaches a fixed point: a grown frame never feeds a wider width back", () => {
    const { host } = withContainer(800);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container: host,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    // Content is twice the column: the frame grows past its wrapper.
    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10, width: 1_600 });
    });
    expect(iframe.style.width).toBe("1600px");

    // The growth itself triggers the observer again (as it would in a
    // browser). The wrapper's width is unchanged, so NOTHING is sent — the
    // program is never re-invoked on its own growth, and the frame settles.
    fireResize();
    expect(bridge.sendResize).not.toHaveBeenCalled();

    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10, width: 1_600 });
    });
    expect(iframe.style.width).toBe("1600px");
  });

  it("coalesces a burst of observer ticks into a single send", () => {
    const { host, setWidth } = withContainer(800);
    render(<D3SandboxFrameUI {...baseProps} />, { container: host });

    // Several ticks before any frame runs — a window-edge drag.
    act(() => {
      const observer = observers[observers.length - 1];
      setWidth(700);
      observer.cb([], {} as ResizeObserver);
      setWidth(600);
      observer.cb([], {} as ResizeObserver);
      setWidth(520);
      observer.cb([], {} as ResizeObserver);
    });
    expect(bridge.sendResize).not.toHaveBeenCalled();

    act(() => {
      for (const cb of frameQueue.splice(0)) cb(0);
    });

    expect(bridge.sendResize).toHaveBeenCalledTimes(1);
    expect(bridge.sendResize).toHaveBeenCalledWith({ width: 520, height: 360 });
  });

  it("narrows the frame back when the column shrinks", () => {
    const { host, setWidth } = withContainer(1_000);
    const { container: mounted } = render(<D3SandboxFrameUI {...baseProps} />, {
      container: host,
    });
    const iframe = mounted.querySelector("iframe") as HTMLIFrameElement;

    act(() => {
      callbacks().onRendered({ height: 400, rowCount: 10, width: 300 });
    });
    expect(iframe.style.width).toBe("1000px");

    setWidth(600);
    fireResize();

    expect(iframe.style.width).toBe("600px");
  });

  // The wrapper's height grows with the frame, so it re-fires this observer.
  // Since only width is ever sent, a height-only change must send nothing —
  // otherwise the frame re-renders on its own growth (grow → resize →
  // re-render → grow), the loop seen in the #278 smoke walk.
  it("ignores an observer tick when the container width is unchanged", () => {
    const { host } = withContainer(800);
    render(<D3SandboxFrameUI {...baseProps} />, { container: host });

    act(() => {
      callbacks().onRendered({ height: 1_200, rowCount: 10, width: 700 });
    });
    fireResize();
    expect(bridge.sendResize).not.toHaveBeenCalled();
  });

  it("disconnects the observer on unmount", () => {
    const { host } = withContainer(800);
    const { unmount } = render(<D3SandboxFrameUI {...baseProps} />, {
      container: host,
    });
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("mounts and renders when ResizeObserver is unavailable (fail-open)", () => {
    // @ts-expect-error — deliberately removing the API.
    delete global.ResizeObserver;
    const { host } = withContainer(480);

    expect(() =>
      render(<D3SandboxFrameUI {...baseProps} />, { container: host })
    ).not.toThrow();

    // Still initialized at the real container width — degraded, not broken.
    expect(createSandboxBridge.mock.calls[0][1].size).toEqual({
      width: 480,
      height: 360,
    });
    expect(bridge.sendResize).not.toHaveBeenCalled();
  });
});
