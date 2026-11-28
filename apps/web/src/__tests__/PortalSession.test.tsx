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
const mockUsageData = jest.fn<() => unknown>(() => undefined);
const mockSendMessage = jest.fn<() => Promise<unknown>>();
const mockResetMessages = jest.fn<() => Promise<unknown>>();
const mockPinPortalResult = jest.fn();
// #699: the container reads the portal's station to lock the composer when
// it's gone for the caller; null = the station loads fine.
const mockStationError = jest.fn<() => unknown>(() => null);
// #1044: the station the portal loads; its enabledToolpacks decide whether
// the empty conversation offers product help. undefined = not loaded.
const mockStationData = jest.fn<() => unknown>(() => undefined);

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    // #498: the container reads the org's tier to decide the upgrade CTA on
    // the turn-limit notice (deduped with Portal.view's identical query).
    organizations: {
      usage: () => ({ data: mockUsageData(), isLoading: false, error: null }),
      // #690: PortalMessage gates Pin result on the caller's pin create (#708).
      current: () => ({
        data: {
          resourcePermissions: {
            pin: { read: true, write: true, delete: true, create: true },
          },
        },
      }),
    },
    stations: {
      get: () => ({
        data: mockStationData(),
        isLoading: false,
        error: mockStationError(),
      }),
    },
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
      // #640: a pin's live data query (inert here — no pin refs).
      data: () => ({
        data: undefined,
        error: null,
        isFetching: false,
        dataUpdatedAt: 0,
        refetch: jest.fn(),
      }),
    },
    // Used by TableWidget when a streaming or persisted chart/table block
    // carries a queryHandle. Tests that exercise that path inject a `data`
    // shape; the default returns nothing so untargeted tests are unaffected.
    portalSql: {
      // #349: TableWidget runs useWidgetRefresh, which resolves both
      // addressers at render time even when there is no blockRef to refresh.
      widgetRefresh: () => ({
        mutateAsync: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(undefined),
        isPending: false,
      }),
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
    // #1036: handleStreamDone refreshes usage, and stations after a turn
    // that attached or detached a view.
    organizations: {
      usage: () => ["organizations", "usage"],
    },
    stations: {
      root: ["stations"],
    },
  },
}));

// Auth is provided by `test-utils`' default AuthContext (#607): the token
// comes from the seam's `getToken`, not a vendor mock, so no `@auth0/auth0-react`
// stub is needed here.

// `usePortalChatLock` + `portal-stream.util` open SSE connections —
// short-circuit them. The stub was a no-op object; #279 upgraded it to the
// capturable `MockEventSource` so a test can drive tool-step events through the
// container.
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

const { QueryClient } = await import("@tanstack/react-query");

const { expectNoAxeViolations, render, screen, fireEvent, waitFor, act } =
  await import("./test-utils");
const { PortalSessionUI } =
  await import("../components/PortalSession.component");
const { CHAT_INPUT_PLACEHOLDER } =
  await import("../components/ChatWindow.component");

// #349: handle-backed tables reach the snapshot fetch through the core
// renderer registry now, not the retired `renderWebBlock` arm — so the test
// has to perform the same registration `main.tsx` does at bootstrap.
const { registerTableBlockRenderer } = await import("../modules/TableWidget");
registerTableBlockRenderer();

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
      capabilities: { read: true, write: true, delete: true },
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

  // #1044: the body no longer assumes data, since Administrate has none.
  const EMPTY_BODY =
    "Ask questions, explore your data, chart it and change it through conversation. Depending on this station's tool packs, the assistant can also answer questions about your organization, from its stations and views to who has access.";

  it("shows the generic body, and no product-help line by default (#1044)", () => {
    render(<PortalSessionUI {...defaultProps} />);
    expect(screen.getByText(EMPTY_BODY)).toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-session-empty-help")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-session-empty-getting-started-link")
    ).not.toBeInTheDocument();
  });

  it("offers product help, linked to Getting Started, when the station has the Help pack (#1044)", () => {
    render(<PortalSessionUI {...defaultProps} helpAvailable />);
    expect(screen.getByText(EMPTY_BODY)).toBeInTheDocument();
    expect(screen.getByTestId("portal-session-empty-help")).toHaveTextContent(
      "Not sure where to start? Ask how anything in Portals works."
    );
    const link = screen.getByTestId(
      "portal-session-empty-getting-started-link"
    );
    expect(link).toHaveAttribute(
      "href",
      "/help?tab=faq&category=getting-started"
    );
    expect(link).toHaveTextContent("Getting started with Portals →");
  });

  it("drops the product-help line when the station has no Help pack (#1044)", () => {
    render(<PortalSessionUI {...defaultProps} helpAvailable={false} />);
    expect(
      screen.queryByTestId("portal-session-empty-help")
    ).not.toBeInTheDocument();
    // The portal FAQ link stays either way.
    expect(
      screen.getByTestId("portal-session-empty-help-link")
    ).toHaveAttribute("href", "/help?tab=faq&category=analytics");
  });

  it("points the empty state's help link at the portal FAQ, not the Help front door (#365)", () => {
    render(<PortalSessionUI {...defaultProps} />);

    const link = screen.getByTestId("portal-session-empty-help-link");
    // A reader who clicks "learn what portal sessions can do" must land on
    // that material, not on the Getting Started onboarding checklist.
    expect(link).toHaveAttribute("href", "/help?tab=faq&category=analytics");
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

  // #109 / #85, rewired in #349: streaming blocks carrying a queryHandle now
  // route through the core renderer registry (TableWidget) rather than the
  // retired `renderWebBlock` data-table arm, so the streaming block still
  // fetches the Redis snapshot rather than rendering an empty table.
  it("routes a streaming data-table handle block through TableWidget", async () => {
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

  it("has no axe violations, empty and holding a conversation", async () => {
    const empty = render(<PortalSessionUI {...defaultProps} />);
    expect(screen.getByTestId("portal-session-empty")).toBeInTheDocument();
    await expectNoAxeViolations(empty.container);
    empty.unmount();

    // #1044: with the product-help line and its link.
    const withHelp = render(
      <PortalSessionUI {...defaultProps} helpAvailable />
    );
    expect(screen.getByTestId("portal-session-empty-help")).toBeInTheDocument();
    await expectNoAxeViolations(withHelp.container);
    withHelp.unmount();

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
    const { container } = render(
      <PortalSessionUI {...defaultProps} messages={messages} />
    );
    expect(screen.getByText("Hi there")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe("PortalSession (container) via PortalSessionUI", () => {
  beforeEach(() => {
    // #699: tests that lock on the station set it; reset so none leaks.
    mockStationError.mockReturnValue(null);
    mockStationData.mockReturnValue(undefined);
    mockGetPortal.mockReset();
    mockSendMessage.mockReset();
    MockEventSource.reset();
    // #1079: no pending-first-turn mark leaks between tests.
    sessionStorage.clear();
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

  // #1036: the portal header's view list and the station page read the
  // station through react-query; a turn that changed its views refreshes it.
  it.each([
    ["curated_view_attach", "done", true],
    ["curated_view_detach", "done", true],
    ["sql_query", "done", false],
    // The attach committed when its result arrived; a later failure doesn't
    // undo it, so the station still refreshes.
    ["curated_view_attach", "stream_error", true],
  ])(
    "a turn that ran %s and ended with %s refreshes stations: %s",
    async (toolName, ending, refreshes) => {
      // `done` refetches the portal, which makeQueryResult doesn't stub.
      mockGetPortal.mockReturnValue({
        ...makeQueryResult([]),
        refetch: jest.fn(async () => ({})),
      });
      mockSendMessage.mockResolvedValue(undefined);
      const queryClient = new QueryClient();
      const invalidate = jest.spyOn(queryClient, "invalidateQueries");

      const { PortalSession } =
        await import("../components/PortalSession.component");
      render(<PortalSession portalId="portal-1" />, { queryClient });

      fireEvent.change(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER), {
        target: { value: "Attach it here" },
      });
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));

      const stream = await waitFor(() => {
        const es = MockEventSource.findByUrl("/stream");
        expect(es).toBeDefined();
        return es!;
      });
      await act(async () => {
        // As the server sends it: an attach result has no display shape, so
        // only tool_call / tool_call_end arrive (#1036 smoke walk).
        stream.__emit("tool_call", {
          type: "tool_call",
          toolCallId: "tc-1",
          toolName,
        });
        stream.__emit("tool_call_end", {
          type: "tool_call_end",
          toolCallId: "tc-1",
          toolName,
        });
        if (ending === "done") {
          stream.__emit("done", { type: "done", messageId: "m-1" });
        } else {
          stream.__emit("stream_error", {
            type: "stream_error",
            message: "Something failed",
          });
        }
      });

      const stationsRefreshed = () =>
        invalidate.mock.calls.some(
          ([filters]) =>
            JSON.stringify(
              (filters as { queryKey?: unknown } | undefined)?.queryKey
            ) === JSON.stringify(["stations"])
        );
      if (refreshes) {
        await waitFor(() => expect(stationsRefreshed()).toBe(true));
      } else {
        await waitFor(() => {
          expect(invalidate).toHaveBeenCalledWith({
            queryKey: ["organizations", "usage"],
          });
        });
        expect(stationsRefreshed()).toBe(false);
      }
    }
  );

  // #1071: the Tags page and every taggable list read tags through
  // react-query; a turn that changed tags refreshes them.
  it.each([
    ["tag_assign", true],
    ["tag_delete", true],
    ["tag_list", false],
  ])("a turn that ran %s refreshes tags: %s", async (toolName, refreshes) => {
    mockGetPortal.mockReturnValue({
      ...makeQueryResult([]),
      refetch: jest.fn(async () => ({})),
    });
    mockSendMessage.mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const { tagCatalogChangeKeys } =
      await import("../utils/tag-invalidation.util");

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />, { queryClient });

    fireEvent.change(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER), {
      target: { value: "Tag these as Finance" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const stream = await waitFor(() => {
      const es = MockEventSource.findByUrl("/stream");
      expect(es).toBeDefined();
      return es!;
    });
    await act(async () => {
      stream.__emit("tool_call", {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName,
      });
      stream.__emit("tool_call_end", {
        type: "tool_call_end",
        toolCallId: "tc-1",
        toolName,
      });
      stream.__emit("done", { type: "done", messageId: "m-1" });
    });

    const invalidated = (key: unknown) =>
      invalidate.mock.calls.some(
        ([filters]) =>
          JSON.stringify(
            (filters as { queryKey?: unknown } | undefined)?.queryKey
          ) === JSON.stringify(key)
      );
    if (refreshes) {
      await waitFor(() => {
        for (const key of tagCatalogChangeKeys()) {
          expect(invalidated(key)).toBe(true);
        }
      });
    } else {
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: ["organizations", "usage"],
        });
      });
      for (const key of tagCatalogChangeKeys()) {
        expect(invalidated(key)).toBe(false);
      }
    }
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

  // #699: a revoked share or a deleted station answers 404, and the server
  // would refuse the send; the composer says why instead.
  it("locks the composer with a reason when the portal's station is unavailable", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockStationError.mockReturnValue({
      status: 404,
      code: "STATION_NOT_FOUND",
      message: "Station not found",
    });

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    expect(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)).toBeDisabled();
    expect(
      screen.getByText("This portal's station isn't available to you.")
    ).toBeInTheDocument();
  });

  // #1044: the container reads the station the portal already loads, so the
  // empty conversation offers product help exactly where the pack is.
  // #1127: a caller granted read, not write, on someone else's portal would
  // have every send and reset refused; the composer says why and offers no
  // Reset.
  it("locks the composer and hides Reset for a read-only caller", async () => {
    const result = makeQueryResult([]);
    result.data!.portal.capabilities = {
      read: true,
      write: false,
      delete: false,
    };
    mockGetPortal.mockReturnValue(result);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    expect(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)).toBeDisabled();
    expect(
      screen.getByText("You can read this portal, but not send messages in it.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset/i })
    ).not.toBeInTheDocument();
  });

  it("offers product help when the portal's station has the Help pack", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockStationData.mockReturnValue({
      station: { id: "station-1", enabledToolpacks: ["data_query", "help"] },
    });

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    expect(screen.getByTestId("portal-session-empty-help")).toBeInTheDocument();
  });

  it("offers no product help on a station without the pack, or one that can't load", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockStationData.mockReturnValue({
      station: { id: "station-1", enabledToolpacks: ["data_query"] },
    });
    const { PortalSession } =
      await import("../components/PortalSession.component");
    const first = render(<PortalSession portalId="portal-1" />);
    expect(screen.getByTestId("portal-session-empty")).toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-session-empty-help")
    ).not.toBeInTheDocument();
    first.unmount();

    mockStationData.mockReturnValue(undefined);
    mockStationError.mockReturnValue({
      status: 404,
      code: "STATION_NOT_FOUND",
      message: "Station not found",
    });
    render(<PortalSession portalId="portal-1" />);
    expect(
      screen.queryByTestId("portal-session-empty-help")
    ).not.toBeInTheDocument();
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

  // ── #498 — the turn-limit notice ─────────────────────────────────────

  it("renders the turn-limit notice (with upgrade CTA) on AGENT_TURN_LIMITED and keeps the composer usable", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockUsageData.mockReturnValue({ tier: { tier: "standard" } });
    mockSendMessage.mockRejectedValue(
      Object.assign(
        new Error(
          "You've reached your plan's agent-turn limit for today. It resets at midnight UTC."
        ),
        {
          code: "AGENT_TURN_LIMITED",
        }
      )
    );

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "One too many" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/agent-turn limit for today/i)
      ).toBeInTheDocument();
    });
    // Upgrade CTA for a non-pro tier; composer stays enabled.
    expect(screen.getByText("View plans")).toBeInTheDocument();
    expect(input).toBeEnabled();
    // The optimistic message was rolled back, and its text is back in the
    // composer to send again (#1137 code review).
    expect(
      screen.queryByTestId("portal-session-empty")
    ).not.toBeInTheDocument();
    await waitFor(() => expect(input).toHaveValue("One too many"));
  });

  it("a non-turn-limit send failure does NOT render the notice", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockRejectedValue(
      Object.assign(new Error("boom"), { code: "PORTAL_NOT_FOUND" })
    );

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });
    expect(screen.queryByText(/agent-turn limit/i)).not.toBeInTheDocument();
  });

  // #1127: the typed message is cleared on submit, so a refused send says so
  // rather than silently dropping it.
  it("raises a toast naming the refusal when a send fails", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockRejectedValue(
      Object.assign(
        new Error("You don't have permission to edit this portal."),
        { code: "PERMISSION_DENIED", status: 403 }
      )
    );

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(
      await screen.findByText("You don't have permission to edit this portal.")
    ).toBeInTheDocument();
  });

  // ── #1079 — resume a pending first turn, hold a refused one ─────────

  const responseStreams = () =>
    MockEventSource.instances.filter((es) => es.url.includes("/stream"));
  const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));
  const pendingTurn = () => ({
    ...makeQueryResult([
      makeMessage({
        id: "msg-u",
        role: "user",
        blocks: [{ type: "text", content: "How many orders shipped?" }],
      }),
    ]),
    // `done` refetches the portal, which makeQueryResult doesn't stub.
    refetch: jest.fn(async () => ({})),
  });

  const justCreated = {
    initialEntry: "/portals/portal-1",
    initialState: { pendingInitialMessage: true },
  };

  it("answers the first question of a portal the start box just created, once, even after a refetch", async () => {
    mockGetPortal.mockImplementation(pendingTurn);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    const { rerender, router } = render(
      <PortalSession portalId="portal-1" />,
      justCreated
    );

    await waitFor(() => expect(responseStreams()).toHaveLength(1));
    // The turn ends, so nothing is streaming any more...
    act(() => {
      responseStreams()[0].__emit("done", { type: "done", messageId: "m-1" });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled()
    );
    // ...and a refetch hands back a fresh result whose newest row is still
    // the user's. The session doesn't open a second stream for it.
    rerender(<PortalSession portalId="portal-1" />);
    await settle();
    expect(responseStreams()).toHaveLength(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    // The mark is gone, so Back and Forward don't answer it again.
    expect(router.history.location.state.pendingInitialMessage).toBeUndefined();
  });

  // #1137 code review: a failed turn stores no reply, so its question stays
  // the newest row. Re-running it on every visit would call the model
  // without the turn ceiling's admission.
  it("doesn't re-run an older unanswered question when a portal is opened", async () => {
    mockGetPortal.mockImplementation(pendingTurn);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    await settle();
    expect(responseStreams()).toHaveLength(0);
  });

  // #1137 adversarial walk: Back pressed while the start box's create was in
  // flight. The question was admitted but the portal never opened, so the
  // first visit after (from Recent portals, no history state) answers it.
  it("answers an admitted first question on the first visit after leaving mid-start, once", async () => {
    mockGetPortal.mockImplementation(pendingTurn);
    const { rememberPendingFirstTurn, hasPendingFirstTurn } =
      await import("../utils/portal-initial-message.util");
    rememberPendingFirstTurn("portal-1");

    const { PortalSession } =
      await import("../components/PortalSession.component");
    const { unmount } = render(<PortalSession portalId="portal-1" />);

    await waitFor(() => expect(responseStreams()).toHaveLength(1));
    expect(hasPendingFirstTurn("portal-1")).toBe(false);
    act(() => {
      responseStreams()[0].__emit("done", { type: "done", messageId: "m-1" });
    });
    unmount();

    // A later visit finds no mark, so a turn that failed isn't re-run.
    render(<PortalSession portalId="portal-1" />);
    await settle();
    expect(responseStreams()).toHaveLength(1);
  });

  it("doesn't answer on another portal's mark", async () => {
    mockGetPortal.mockImplementation(pendingTurn);
    const { rememberPendingFirstTurn, hasPendingFirstTurn } =
      await import("../utils/portal-initial-message.util");
    rememberPendingFirstTurn("portal-2");

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    await settle();
    expect(responseStreams()).toHaveLength(0);
    expect(hasPendingFirstTurn("portal-2")).toBe(true);
  });

  it("doesn't resume a portal whose newest message is the assistant's", async () => {
    mockGetPortal.mockReturnValue(
      makeQueryResult([
        makeMessage({ id: "msg-u", role: "user", created: 1 }),
        makeMessage({ id: "msg-a", role: "assistant", created: 2 }),
      ])
    );

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />, justCreated);

    await settle();
    expect(responseStreams()).toHaveLength(0);
  });

  it("doesn't resume for a caller who can only read the portal", async () => {
    const result = pendingTurn();
    result.data!.portal.capabilities = {
      read: true,
      write: false,
      delete: false,
    };
    mockGetPortal.mockReturnValue(result);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />, justCreated);

    await settle();
    expect(responseStreams()).toHaveLength(0);
  });

  const refusedState = {
    refusedInitialMessage: {
      prompt: "How many orders shipped?",
      message: "You're sending messages too quickly. Try again in a moment.",
    },
  };

  it("puts a refused first question in the composer and shows the turn-limit notice", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockUsageData.mockReturnValue({ tier: { tier: "standard" } });

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />, {
      initialEntry: "/portals/portal-1",
      initialState: refusedState,
    });

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    await waitFor(() => expect(input).toHaveValue("How many orders shipped?"));
    expect(
      screen.getByText(refusedState.refusedInitialMessage.message)
    ).toBeInTheDocument();
    expect(screen.getByText("View plans")).toBeInTheDocument();
    expect(responseStreams()).toHaveLength(0);
  });

  it("clears the refused question from history, so Back and Forward don't bring it back", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));

    const { PortalSession } =
      await import("../components/PortalSession.component");
    const { router } = render(<PortalSession portalId="portal-1" />, {
      initialEntry: "/portals/portal-1",
      initialState: refusedState,
    });

    await waitFor(() =>
      expect(
        router.history.location.state.refusedInitialMessage
      ).toBeUndefined()
    );
    expect(router.history.location.pathname).toBe("/portals/portal-1");
  });

  it("clears the notice when the refused question is sent again", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockResolvedValue(undefined);

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />, {
      initialEntry: "/portals/portal-1",
      initialState: refusedState,
    });

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    await waitFor(() => expect(input).toHaveValue("How many orders shipped?"));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({
        message: "How many orders shipped?",
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByText(refusedState.refusedInitialMessage.message)
      ).not.toBeInTheDocument()
    );
  });

  // #1137 code review: a message over the 20,000-character limit is refused
  // with a 400; the composer was cleared on submit, so the text comes back.
  it("puts a refused message back in the composer", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockRejectedValue(
      Object.assign(
        new Error(
          "Invalid portal payload: message: Message must be 20000 characters or fewer"
        ),
        { code: "PORTAL_INVALID_PAYLOAD", status: 400 }
      )
    );

    const { PortalSession } =
      await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "A very long table" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalled());
    await waitFor(() => expect(input).toHaveValue("A very long table"));
  });
});
