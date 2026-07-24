import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

import type { D3BlockContent } from "@portalai/core/contracts";
import type { HandleSnapshotPayload } from "../../../api/portal-sql.api";
import type { D3SandboxTheme } from "../utils/sandbox-theme.util";

// ── SDK mock ─────────────────────────────────────────────────────────

const mutateAsync =
  jest.fn<
    (vars: {
      handleId: string;
      offset: number;
      limit: number;
    }) => Promise<HandleSnapshotPayload>
  >();

jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: {
    portalSql: {
      handleSnapshotPage: () => ({ mutateAsync }),
    },
  },
}));

const { D3Widget, D3WidgetUI } = await import("../D3Widget.component");

// ── Fixtures ─────────────────────────────────────────────────────────

const THEME: D3SandboxTheme = {
  mode: "light",
  background: "#fff",
  text: "#111",
  fontFamily: "sans-serif",
  monospaceFontFamily: "monospace",
  categorical: ["#123456"],
};

const PROGRAM = "api.d3.select(api.container);";

const uiBase = {
  program: PROGRAM,
  theme: THEME,
  batches: [],
  totalRows: 2_250,
  receivedRows: 0,
  complete: false,
  loading: true,
  error: null as string | null,
  onFrameError: jest.fn(),
};

beforeEach(() => {
  mutateAsync.mockReset();
});

// ── D3WidgetUI (spec cases 21–22) ────────────────────────────────────

describe("D3WidgetUI", () => {
  it("shows the loading state with the row-count label before the first batch", () => {
    render(<D3WidgetUI {...uiBase} />);
    expect(screen.getByTestId("d3-widget-loading")).toBeInTheDocument();
    expect(screen.getByText(/Loading 2,250 rows/)).toBeInTheDocument();
  });

  it('renders the truncated row count as "N+"', () => {
    render(<D3WidgetUI {...uiBase} truncated />);
    expect(screen.getByText(/Loading 2,250\+ rows/)).toBeInTheDocument();
  });

  it("shows a progress caption while batches are incomplete, gone when complete", () => {
    const batches = [{ rows: [{ x: 1 }], seq: 0, done: false }];
    const { rerender } = render(
      <D3WidgetUI
        {...uiBase}
        loading={false}
        batches={batches}
        receivedRows={1_000}
      />
    );
    expect(
      screen.getByText(/Rendering 1,000 of 2,250 rows/)
    ).toBeInTheDocument();

    rerender(
      <D3WidgetUI
        {...uiBase}
        loading={false}
        batches={[{ rows: [{ x: 1 }], seq: 0, done: true }]}
        receivedRows={2_250}
        complete
      />
    );
    expect(
      screen.queryByText(/Rendering .* of .* rows/)
    ).not.toBeInTheDocument();
  });

  it("renders the title when provided", () => {
    render(
      <D3WidgetUI
        {...uiBase}
        loading={false}
        batches={[{ rows: [], seq: 0, done: true }]}
        complete
        title="Monthly totals"
      />
    );
    expect(screen.getByText("Monthly totals")).toBeInTheDocument();
  });

  it("renders the error card instead of the frame", () => {
    const { container } = render(
      <D3WidgetUI {...uiBase} loading={false} error="Program threw: boom" />
    );
    expect(screen.getByTestId("d3-widget-error")).toBeInTheDocument();
    expect(screen.getByText(/Program threw: boom/)).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
  });
});

// ── D3Widget container (spec cases 23–24) ────────────────────────────

describe("D3Widget", () => {
  it("renders inline content as a single done batch with no SDK call", async () => {
    const content: D3BlockContent = {
      program: PROGRAM,
      rows: [{ month: "Jan", total: 12 }],
    };
    const { container } = render(<D3Widget content={content} />);

    await waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull()
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    // Complete immediately — no progress caption.
    expect(
      screen.queryByText(/Rendering .* of .* rows/)
    ).not.toBeInTheDocument();
  });

  it("drives handle content through the paged SDK and forwards envelope metadata", async () => {
    mutateAsync.mockImplementation(async ({ offset }) => ({
      rows:
        offset === 0
          ? Array.from({ length: 1_000 }, (_, i) => ({ id: i }))
          : Array.from({ length: 250 }, (_, i) => ({ id: 1_000 + i })),
      total: 1_250,
      offset,
      limit: 1_000,
    }));
    const content: D3BlockContent = {
      program: PROGRAM,
      queryHandle: "qh-widget",
      rowCount: 1_250,
      schema: [{ name: "id", type: "numeric" }],
      sampled: false,
      truncated: true,
      samplePeek: [],
      sql: "SELECT id FROM t",
    };
    const { container } = render(<D3Widget content={content} />);

    // Envelope rowCount + truncated flow into the visible label ("N+")
    // synchronously, in the pre-first-batch loading state.
    expect(screen.getByText(/Loading 1,250\+ rows/)).toBeInTheDocument();

    await waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull()
    );
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ handleId: "qh-widget", offset: 0 })
    );
  });

  it("shows the error card for content that fails the block contract", () => {
    render(<D3Widget content={{ title: "no program" } as never} />);
    expect(screen.getByTestId("d3-widget-error")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
