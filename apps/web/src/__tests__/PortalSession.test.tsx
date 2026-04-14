import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PortalGetResponsePayload, PortalMessageResponse } from "@portalai/core/contracts";
import type { ApiError } from "../utils";

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
    },
    portalResults: {
      pin: () => ({
        mutate: mockPinPortalResult,
        isPending: false,
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
    getAccessTokenSilently: jest.fn<() => Promise<string>>().mockResolvedValue("test-token"),
  }),
}));

jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

jest.unstable_mockModule("react-vega", () => ({
  VegaLite: () => <div data-testid="vega-lite-chart" />,
  Vega: () => <div data-testid="vega-chart" />,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

// ── Imports ──────────────────────────────────────────────────────────

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { PortalSessionUI } = await import(
  "../components/PortalSession.component"
);
const { CHAT_INPUT_PLACEHOLDER } = await import(
  "../components/ChatWindow.component"
);

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
    expect(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)).toBeInTheDocument();
  });

  it("renders the empty state when there are no messages or streaming content", () => {
    render(<PortalSessionUI {...defaultProps} />);
    expect(screen.getByTestId("portal-session-empty")).toBeInTheDocument();
  });

  it("hides the empty state once messages are present", () => {
    const messages = [
      makeMessage({ id: "msg-1", role: "user", blocks: [{ type: "text", content: "Hello" }] }),
    ];
    render(<PortalSessionUI {...defaultProps} messages={messages} />);
    expect(screen.queryByTestId("portal-session-empty")).not.toBeInTheDocument();
  });

  it("hides the empty state while streaming blocks are rendering", () => {
    render(
      <PortalSessionUI
        {...defaultProps}
        streamingBlocks={[{ type: "text", content: "..." }]}
      />
    );
    expect(screen.queryByTestId("portal-session-empty")).not.toBeInTheDocument();
  });

  it("renders a list of messages", () => {
    const messages = [
      makeMessage({ id: "msg-1", role: "user", blocks: [{ type: "text", content: "Hello" }] }),
      makeMessage({ id: "msg-2", role: "assistant", blocks: [{ type: "text", content: "Hi there" }] }),
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

  it("renders data-table streaming blocks inline", () => {
    const dataTableBlock = {
      type: "data-table",
      content: {
        columns: ["id", "value"],
        rows: [{ id: 1, value: 42 }],
      },
    };
    render(
      <PortalSessionUI
        {...defaultProps}
        streamingBlocks={[dataTableBlock]}
      />
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("value")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders vega streaming blocks inline", async () => {
    const vegaBlock = {
      type: "vega",
      content: { data: [{ values: [] }], marks: [] },
    };
    render(
      <PortalSessionUI
        {...defaultProps}
        streamingBlocks={[vegaBlock]}
      />
    );
    expect(await screen.findByTestId("vega-chart")).toBeInTheDocument();
  });

  it("calls onSubmit with message when submit button clicked", async () => {
    const onSubmit = jest.fn();
    render(
      <PortalSessionUI
        {...defaultProps}
        onSubmit={onSubmit}
      />
    );
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
  });

  it("loads history on mount — messages from query appear", async () => {
    const messages = [
      makeMessage({ id: "msg-1", role: "user", blocks: [{ type: "text", content: "First message" }] }),
    ];
    mockGetPortal.mockReturnValue(makeQueryResult(messages));

    const { PortalSession } = await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    await waitFor(() => {
      expect(screen.getByText("First message")).toBeInTheDocument();
    });
  });

  it("submit triggers sendMessage", async () => {
    mockGetPortal.mockReturnValue(makeQueryResult([]));
    mockSendMessage.mockResolvedValue(undefined);

    const { PortalSession } = await import("../components/PortalSession.component");
    render(<PortalSession portalId="portal-1" />);

    const input = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
    fireEvent.change(input, { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ message: "Hello!" });
    });
  });
});
