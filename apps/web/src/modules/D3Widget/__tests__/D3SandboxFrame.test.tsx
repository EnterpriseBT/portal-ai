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
