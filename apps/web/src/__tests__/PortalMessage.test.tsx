import { jest } from "@jest/globals";
import type { UseMutationResult } from "@tanstack/react-query";
import type { PortalMessageResponse } from "@portalai/core/contracts";

// ── Mocks ────────────────────────────────────────────────────────────

const mockPin = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalResults: {
      pin: () => ({
        mutate: mockPin,
        isPending: false,
      } as Partial<UseMutationResult>),
    },
  },
}));

// Mock react-markdown and react-vega so jsdom doesn't choke on them.
jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

jest.unstable_mockModule("react-vega", () => ({
  VegaLite: () => <div data-testid="vega-lite-chart" />,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

// ── Imports ──────────────────────────────────────────────────────────

const { render, screen, fireEvent } = await import("./test-utils");
const { PortalMessageUI } = await import(
  "../components/PortalMessage.component"
);

// ── Fixtures ─────────────────────────────────────────────────────────

const makeMessage = (
  overrides: Partial<PortalMessageResponse> = {}
): PortalMessageResponse => ({
  id: "msg-1",
  portalId: "portal-1",
  organizationId: "org-1",
  role: "assistant",
  blocks: [{ type: "text", content: "Hello world" }],
  created: Date.now(),
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("PortalMessageUI", () => {
  describe("user messages", () => {
    it("renders user message content as plain text", () => {
      const message = makeMessage({ role: "user", blocks: [{ type: "text", content: "Hi there" }] });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.getByText("Hi there")).toBeInTheDocument();
    });

    it("does not show pin button for user messages", () => {
      const message = makeMessage({ role: "user" });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.queryByRole("button", { name: /pin result/i })).not.toBeInTheDocument();
    });
  });

  describe("assistant messages — text block", () => {
    it("renders text block content via ContentBlockRenderer", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", content: "Here is your answer" }],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.getByText("Here is your answer")).toBeInTheDocument();
    });

    it("shows a pin icon button for each assistant block", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          { type: "text", content: "Block 1" },
          { type: "text", content: "Block 2" },
        ],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      const pinButtons = screen.getAllByRole("button", { name: /pin result/i });
      expect(pinButtons).toHaveLength(2);
    });
  });

  describe("assistant messages — vega-lite block", () => {
    it("renders vega-lite block via ContentBlockRenderer", async () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "vega-lite", content: { mark: "bar" } }],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(await screen.findByTestId("vega-lite-chart")).toBeInTheDocument();
    });

    it("shows a pin button for vega-lite blocks with content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "vega-lite", content: { mark: "point" } }],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.getByRole("button", { name: /pin result/i })).toBeInTheDocument();
    });
  });

  describe("empty / non-pinnable blocks", () => {
    it("does not render blocks with empty object content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "vega-lite", content: {} }],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.queryByRole("button", { name: /pin result/i })).not.toBeInTheDocument();
    });

    it("does not render blocks with null content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", content: null }],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.queryByRole("button", { name: /pin result/i })).not.toBeInTheDocument();
    });

    it("does not render blocks with empty string content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", content: "   " }],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.queryByRole("button", { name: /pin result/i })).not.toBeInTheDocument();
    });

    it("does not render tool-call or tool-result blocks", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          { type: "tool-call", content: { name: "query" } },
          { type: "tool-result", content: { result: "ok" } },
        ],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      expect(screen.queryByRole("button", { name: /pin result/i })).not.toBeInTheDocument();
    });

    it("only renders pin buttons for blocks with content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          { type: "text", content: "Visible" },
          { type: "tool-call", content: { name: "query" } },
          { type: "text", content: "" },
          { type: "vega-lite", content: { mark: "bar" } },
        ],
      });
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      const pinButtons = screen.getAllByRole("button", { name: /pin result/i });
      expect(pinButtons).toHaveLength(2);
    });
  });

  describe("pin dialog", () => {
    it("opens the name dialog when a pin button is clicked", () => {
      const message = makeMessage();
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      expect(screen.getByText("Name this result")).toBeInTheDocument();
    });

    it("calls onPin with messageId, blockIndex, and name when confirmed", () => {
      const onPin = jest.fn();
      const message = makeMessage();
      render(<PortalMessageUI message={message} onPin={onPin} />);
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      fireEvent.change(screen.getByRole("textbox", { name: /name/i }), { target: { value: "My result" } });
      fireEvent.click(screen.getByRole("button", { name: /^pin$/i }));
      expect(onPin).toHaveBeenCalledWith("msg-1", 0, "My result");
    });

    it("disables the confirm button when name is empty", () => {
      const message = makeMessage();
      render(<PortalMessageUI message={message} onPin={jest.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      expect(screen.getByRole("button", { name: /^pin$/i })).toBeDisabled();
    });
  });
});
