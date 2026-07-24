import { jest } from "@jest/globals";
import { render } from "@testing-library/react";

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
