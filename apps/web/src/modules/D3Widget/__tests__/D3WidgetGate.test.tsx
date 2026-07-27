import { jest } from "@jest/globals";

import type { D3BlockContent } from "@portalai/core/contracts";
import type { HandleSnapshotPayload } from "../../../api/portal-sql.api";

// ── Mocks ────────────────────────────────────────────────────────────

// Controllable in-view state so the test drives mount/teardown directly.
let mockInView = true;
jest.unstable_mockModule("../../../utils/use-in-view.util", () => ({
  useInView: () => mockInView,
  UI_INVIEW_MARGIN: "100% 0px",
}));

const pageMutate =
  jest.fn<
    (v: {
      handleId: string;
      offset: number;
      limit: number;
    }) => Promise<HandleSnapshotPayload>
  >();
const refreshMutate = jest.fn();

jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: {
    portalSql: {
      handleSnapshotPage: () => ({ mutateAsync: pageMutate }),
      widgetRefresh: () => ({ mutateAsync: refreshMutate, isPending: false }),
    },
  },
}));

const { render, screen } = await import("../../../__tests__/test-utils");
const { D3WidgetGate } = await import("../D3WidgetGate.component");

const PROGRAM = "api.d3.select(api.container);";
const handleContent: D3BlockContent = {
  program: PROGRAM,
  queryHandle: "qh-gate",
  rowCount: 5000,
  schema: [{ name: "x", type: "numeric" }],
  sampled: false,
  truncated: false,
  samplePeek: [],
  sql: "SELECT x FROM t",
} as D3BlockContent;

beforeEach(() => {
  mockInView = true;
  pageMutate.mockReset();
  pageMutate.mockResolvedValue({ rows: [], total: 0, offset: 0, limit: 1000 });
  refreshMutate.mockReset();
});

describe("D3WidgetGate (#271)", () => {
  it("mounts the live widget when in view", () => {
    render(<D3WidgetGate content={handleContent} />);
    expect(screen.getByTestId("d3-widget")).toBeInTheDocument();
    expect(
      screen.queryByTestId("d3-widget-placeholder")
    ).not.toBeInTheDocument();
  });

  it("renders a height-preserving placeholder and does NOT page when offscreen", () => {
    mockInView = false;
    render(<D3WidgetGate content={handleContent} />);
    const placeholder = screen.getByTestId("d3-widget-placeholder");
    expect(placeholder).toBeInTheDocument();
    // Seed height until a render measures the real one.
    expect(placeholder.style.height).toBe("360px");
    // The live widget (and its paging) never mount.
    expect(screen.queryByTestId("d3-widget")).not.toBeInTheDocument();
    expect(pageMutate).not.toHaveBeenCalled();
  });

  it("swaps live → placeholder when it scrolls out of view", () => {
    const { rerender } = render(<D3WidgetGate content={handleContent} />);
    expect(screen.getByTestId("d3-widget")).toBeInTheDocument();

    mockInView = false;
    rerender(<D3WidgetGate content={handleContent} />);
    expect(screen.queryByTestId("d3-widget")).not.toBeInTheDocument();
    expect(screen.getByTestId("d3-widget-placeholder")).toBeInTheDocument();
  });
});
