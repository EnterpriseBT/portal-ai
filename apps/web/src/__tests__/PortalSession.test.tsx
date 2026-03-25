import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PortalGetResponsePayload, PortalMessageResponse } from "@portalai/core/contracts";
import type { ApiError } from "../utils";

// ── Mocks ────────────────────────────────────────────────────────────

const mockGetPortal = jest.fn<() => unknown>();
const mockSendMessage = jest.fn<() => Promise<unknown>>();
const mockPinPortalResult = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portals: {
      get: mockGetPortal,
      sendMessage: () => ({
        mutateAsync: mockSendMessage,
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
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

// ── Imports ──────────────────────────────────────────────────────────

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { PortalSessionUI } = await import(
  "../components/PortalSession.component"
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
    streamingBlocks: null,
    inputValue: "",
    onInputChange: jest.fn(),
    onSubmit: jest.fn(),
    onReset: jest.fn(),
    onCancel: jest.fn(),
    isStreaming: false,
  };

  it("renders ChatWindowUI input", () => {
    render(<PortalSessionUI {...defaultProps} />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText("Type a message...")).toBeDisabled();
  });

  it("calls onSubmit when submit button clicked", () => {
    const onSubmit = jest.fn();
    render(
      <PortalSessionUI
        {...defaultProps}
        inputValue="test message"
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
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

    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(input, { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ message: "Hello!" });
    });
  });
});
