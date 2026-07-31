import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  PortalGetResponsePayload,
  PortalMessageResponse,
} from "@portalai/core/contracts";
import type { ApiError } from "../utils";

import {
  MockEventSource,
  installMockEventSource,
} from "./__mocks__/mock-event-source";

installMockEventSource();

// ── Mocks ────────────────────────────────────────────────────────────

const mockGetPortal = jest.fn<() => unknown>();
const mockSendMessage = jest.fn<() => Promise<unknown>>();
const mockResetMessages = jest.fn<() => Promise<unknown>>();
const mockPinPortalResult = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portals: {
      get: mockGetPortal,
      sendMessage: () => ({
        mutateAsync: mockSendMessage,
        isPending: false,
      }),
      resetMessages: () => ({
        mutateAsync: mockResetMessages,
        isPending: false,
      }),
      // Added when `usePortalChatLock` started reading running-job state.
      runningJobs: () => ({
        data: undefined,
        isLoading: false,
        error: null,
      }),
    },
    portalResults: {
      pin: () => ({
        mutate: mockPinPortalResult,
        isPending: false,
      }),
      // #286: PortalMessage's unpin calls this on every render of the
      // container, so the mock must provide it even though no test here
      // exercises unpinning.
      remove: () => ({
        mutateAsync: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(undefined),
        isPending: false,
      }),
    },
    // Used by QueryResultDataBlock when a streaming or persisted
    // chart/table block carries a queryHandle. Tests that exercise
    // that path inject a `data` shape; the default returns nothing
    // so untargeted tests are unaffected.
    portalSql: {
      handleSnapshot: () => ({
        data: { rows: [{ x: 1 }, { x: 2 }], total: 2, offset: 0, limit: 5000 },
        isLoading: false,
        error: null,
      }),
    },
  },
  queryKeys: {
    portals: {
      get: (id: string) => ["portals", "get", id],
    },
  },
}));

jest.unstable_mockModule("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue("test-token"),
  }),
}));

// `usePortalChatLock` + `portal-stream.util` open SSE connections —
// short-circuit them (the real path reads
// `import.meta.env.VITE_AUTH0_AUDIENCE`, undefined in tests). The stub was a
// no-op object; #279 upgraded it to the capturable `MockEventSource` so a test
// can drive tool-step events through the container.
jest.unstable_mockModule("../api/sse.api", () => ({
  sse: {
    create: () => async (path: string) =>
      new MockEventSource(`https://api.test.com${path}`),
  },
}));

jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

// ── Imports ──────────────────────────────────────────────────────────

const { render, screen, fireEvent, waitFor, act } =
  await import("./test-utils");
const { PortalSessionUI } =
  await import("../components/PortalSession.component");
const { CHAT_INPUT_PLACEHOLDER } =
  await import("../components/ChatWindow.component");

// ── Fixtures ─────────────────────────────────────────────────────────

const makeMessage = (
  overrides: Partial<PortalMessageResponse> = {}
): PortalMessageResponse => ({
  id: "msg-1",
  portalId: "portal-1",
  organizationId: "org-1",
  role: "assistant",
  blocks: [{ type: "text", content: "Welcome!" }],
  created: Date.now(),
  ...overrides,
});

const makeQueryResult = (
  messages: PortalMessageResponse[]
): Partial<UseQueryResult<PortalGetResponsePayload, ApiError>> => ({
  data: {
    portal: {
      id: "portal-1",
      organizationId: "org-1",
      stationId: "station-1",
      name: "Test Portal",
      createdBy: "user-1",
      created: Date.now(),
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      lastOpened: null,
    },
    messages,
  },
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});

/**
 * Force the chat feed's scroll container to look scrolled-away-from-bottom.
 * jsdom reports zero geometry, which reads as "at the bottom" — the state in
 * which the strip is deliberately hidden (#279).
 */
const scrollFeedAwayFromBottom = (container: HTMLElement) => {
  const el = Array.from(container.querySelectorAll("div")).find(
    (d) => getComputedStyle(d).overflow === "auto"
  ) as HTMLElement;
  Object.defineProperty(el, "scrollHeight", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", { value: 300, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });
  fireEvent.scroll(el);
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("PortalSessionUI", () => {
  const defaultProps = {
    portalId: "portal-1",
    messages: [],
    pinnedBlocks: new Map<string, string>(),
    onPinChange: jest.fn(),
    streamingBlocks: null,
    streamError: null,
    chatRef: { current: null },
    onSubmit: jest.fn(),
    onReset: jest.fn(),
    onCancel: jest.fn(),
    onExit: jest.fn(),
    isStreaming: false,
  };

  it("renders ChatWindowUI input", () => {
    render(<PortalSessionUI {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)
    ).toBeInTheDocument();
  });

  it("renders the empty state when there are no messages or streaming content", () => {
    render(<PortalSessionUI {...defaultProps} />);
    expect(screen.getByTestId("portal-session-empty")).toBeInTheDocument();
  });

  it("hides the empty state once messages are present", () => {
    const messages = [
      makeMessage({
        id: "msg-1",
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      }),
    ];
    render(<PortalSessionUI {...defaultProps} messages={messages} />);
    expect(
      screen.queryByTestId("portal-session-empty")
    ).not.toBeInTheDocument();
  });

  it("hides the empty state while streaming blocks are rendering", () => {
    render(
      <PortalSessionUI
        {...defaultProps}
        streamingBlocks={[{ type: "text", content: "..." }]}
      />
    );
    expect(
      screen.queryByTestId("portal-session-empty")
    ).not.toBeInTheDocument();
  });

  it("renders a list of messages", () => {
    const messages = [
      makeMessage({
        id: "msg-1",
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      }),
      makeMessage({
        id: "msg-2",
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there" }],
      }),
    ];
    render(<PortalSessionUI {...defaultProps} messages={messages} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("renders streaming blocks when present", () => {
    render(
      <PortalSessionUI
        {...defaultProps}
        streamingBlocks={[{ type: "text", content: "Streaming..." }]}
      />
    );
    expect(screen.getByText("Streaming...")).toBeInTheDocument();
  });

  it("disables input while streaming", () => {
    render(<PortalSessionUI {...defaultProps} isStreaming={true} />);
    expect(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)).toBeDisabled();
  });

  // #279 — while a tool runs, the phase shows in two places: inline in the
  // feed and pinned above the composer for when the user has scrolled up.
  describe("tool activity surfaces (#279)", () => {
    // A real turn always has the user's optimistic message in the feed, so
    // the empty state is never in play while a tool runs.
    const streaming = {
      ...defaultProps,
      messages: [
        makeMessage({
          id: "msg-user",
          role: "user" as const,
          blocks: [{ type: "text", content: "Chart my revenue" }],
        }),
      ],
      isStreaming: true,
      activeToolLabel: "Building the chart",
      activeToolElapsedSeconds: 18,
    };

    it("names the running tool inline in the feed", () => {
      render(<PortalSessionUI {...streaming} />);
      const indicator = screen.getByTestId("typing-indicator");
      expect(indicator).toHaveTextContent("Building the chart");
      expect(indicator).toHaveTextContent("18s");
    });

    // The two surfaces are mutually exclusive (#279 smoke finding): they carry
    // identical text, so the strip only takes over once the inline indicator
    // has scrolled out of view.
    it("shows only the inline indicator while the feed is at the bottom", () => {
      render(<PortalSessionUI {...streaming} />);
      expect(screen.getByTestId("typing-indicator")).toHaveTextContent(
        "Building the chart"
      );
      expect(
        screen.queryByTestId("tool-activity-strip")
      ).not.toBeInTheDocument();
    });

    it("hands the phase to the pinned strip once the feed is scrolled up", async () => {
      const { container } = render(<PortalSessionUI {...streaming} />);
      scrollFeedAwayFromBottom(container);

      await waitFor(() => {
        const strip = screen.getByTestId("tool-activity-strip");
        expect(strip).toHaveTextContent("Building the chart");
        expect(strip).toHaveTextContent("18s");
      });
    });

    // The bug this ticket fixes: a tool turn's first delta is a one-line
    // preamble, after which the indicator used to unmount and the feed sat
    // frozen. With a tool running it must stay up even once content exists.
    it("keeps the inline indicator up after the first streamed content", () => {
      render(
        <PortalSessionUI
          {...streaming}
          streamingBlocks={[{ type: "text", content: "Let me chart that" }]}
        />
      );
      expect(screen.getByTestId("typing-indicator")).toHaveTextContent(
        "Building the chart"
      );
    });

    it("still hides the indicator once content arrives with no tool running", () => {
      render(
        <PortalSessionUI
          {...defaultProps}
          isStreaming={true}
          streamingBlocks={[{ type: "text", content: "Just a text reply" }]}
        />
      );
      expect(screen.queryByTestId("typing-indicator")).not.toBeInTheDocument();
    });

    it("renders no strip for a tool-free turn", () => {
      render(<PortalSessionUI {...defaultProps} isStreaming={true} />);
      expect(
        screen.queryByTestId("tool-activity-strip")
      ).not.toBeInTheDocument();
    });
  });

  it("renders data-table streaming blocks inline", () => {
    const dataTableBlock = {
      type: "data-table",
      content: {
        columns: ["id", "value"],
        rows: [{ id: 1, value: 42 }],
      },
    };
    render(
      <PortalSessionUI {...defaultProps} streamingBlocks={[dataTableBlock]} />
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("value")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  // #109 / #85: streaming blocks carrying a queryHandle route through the
  // same web/core dispatch (`renderWebBlock`) as persisted messages, so the
  // streaming block fetches the Redis snapshot rather than rendering an
  // empty table. (`sql_query` handle path.)
  it("routes a streaming data-table handle block through QueryResultDataBlock", async () => {
    const streamingHandleBlock = {
      type: "data-table" as const,
      content: {
        queryHandle: "qh-test-streaming-table",
        rowCount: 2,
      },
    };
    render(
      <PortalSessionUI
        {...defaultProps}
        streamingBlocks={[streamingHandleBlock]}
      />
    );
    // Snapshot mock returns rows [{x:1},{x:2}] → data-table renders
    // them under an `x` column header.
    expect(await screen.findByText("x")).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("calls onSubmit with message when submit button clicked", async () => {
    const onSubmit = jest.fn();
    render(<PortalSessionUI {...defaultProps} onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("test message");
  });
});

describe("PortalSession (container) via PortalSessionUI", () => {
  beforeEach(() => {
    mockGetPortal.mockReset();
    mockSendMessage.mockReset();
    MockEventSource.reset();
  });

  // #279 — the one test covering the whole chain: a `tool_call` on the wire
  // becomes an open step in the hook, the newest step resolves to curated copy
  // via `toolPhaseLabel`, and both surfaces render it. The pieces are unit
  // tested individually; this proves they are actually connected.
  it("resolves the phase label from the tool name and clears it on tool_call_end", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockResolvedValue(undefined);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "Chart my revenue" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    // The response stream — not the chat-lock job stream the view also opens.
    const stream = await waitFor(() => {
      const es = MockEventSource.findByUrl("/stream");
      expect(es).toBeDefined();
      return es!;
    });

    await act(async () => {
      stream.__emit("tool_call", {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "sql_query",
      });
    });

    // "Querying your data" is the registry's copy for sql_query — the raw
    // tool name must never reach the user.
    await waitFor(() => {
      expect(screen.getByTestId("typing-indicator")).toHaveTextContent(
        "Querying your data"
      );
    });
    expect(screen.queryByText("sql_query")).not.toBeInTheDocument();

    await act(async () => {
      stream.__emit("tool_call_end", {
        type: "tool_call_end",
        toolCallId: "tc-1",
        toolName: "sql_query",
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("tool-activity-strip")
      ).not.toBeInTheDocument();
    });
  });

  it("loads history on mount — messages from query appear", async () => {
    const messages = [
      makeMessage({
        id: "msg-1",
        role: "user",
        blocks: [{ type: "text", content: "First message" }],
      }),
    ];
    mockGetPortal.mockReturnValue(makeQueryResult(messages));

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    await waitFor(() => {
      expect(screen.getByText("First message")).toBeInTheDocument();
    });
  });

  it("submit triggers sendMessage", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockResolvedValue(undefined);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ message: "Hello!" });
    });
  });
});
