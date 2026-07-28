import { jest } from "@jest/globals";
import type { UseMutationResult } from "@tanstack/react-query";
import type { PortalMessageResponse } from "@portalai/core/contracts";

// ── Mocks ────────────────────────────────────────────────────────────

const mockPin = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalResults: {
      pin: () =>
        ({
          mutate: mockPin,
          isPending: false,
        }) as Partial<UseMutationResult>,
    },
  },
  queryKeys: {
    portalResults: { root: ["portalResults"] },
  },
}));

// Mock react-markdown so jsdom doesn't choke on it.
jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

// ── Imports ──────────────────────────────────────────────────────────

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { registerBlockRenderer } = await import("@portalai/core");
const { PortalMessageUI } =
  await import("../components/PortalMessage.component");

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
      const message = makeMessage({
        role: "user",
        blocks: [{ type: "text", content: "Hi there" }],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(screen.getByText("Hi there")).toBeInTheDocument();
    });

    it("does not show pin button for user messages", () => {
      const message = makeMessage({ role: "user" });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /pin result/i })
      ).not.toBeInTheDocument();
    });

    it("renders a local date+time timestamp from `created` (#180)", () => {
      const created = new Date("2026-07-08T20:34:00Z").getTime();
      const message = makeMessage({ role: "user", created });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      const expected = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(created);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe("assistant messages — text block", () => {
    it("renders text block content via ContentBlockRenderer", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", content: "Here is your answer" }],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
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
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      const pinButtons = screen.getAllByRole("button", { name: /pin result/i });
      expect(pinButtons).toHaveLength(2);
    });
  });

  describe("assistant messages — data-table block", () => {
    it("renders data-table block via ContentBlockRenderer", async () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          {
            type: "data-table",
            content: { columns: ["name"], rows: [{ name: "Alice" }] },
          },
        ],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(await screen.findByText("Alice")).toBeInTheDocument();
    });

    it("shows a pin button for data-table blocks with content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          {
            type: "data-table",
            content: { columns: ["name"], rows: [{ name: "Bob" }] },
          },
        ],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: /pin result/i })
      ).toBeInTheDocument();
    });
  });

  describe("empty / non-pinnable blocks", () => {
    it("does not render blocks with empty object content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "data-table", content: {} }],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /pin result/i })
      ).not.toBeInTheDocument();
    });

    it("does not render blocks with null content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", content: null }],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /pin result/i })
      ).not.toBeInTheDocument();
    });

    it("does not render blocks with empty string content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", content: "   " }],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /pin result/i })
      ).not.toBeInTheDocument();
    });

    it("does not render tool-call or tool-result blocks", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          { type: "tool-call", content: { name: "query" } },
          { type: "tool-result", content: { result: "ok" } },
        ],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /pin result/i })
      ).not.toBeInTheDocument();
    });

    it("only renders pin buttons for blocks with content", () => {
      const message = makeMessage({
        role: "assistant",
        blocks: [
          { type: "text", content: "Visible" },
          { type: "tool-call", content: { name: "query" } },
          { type: "text", content: "" },
          {
            type: "data-table",
            content: { columns: ["x"], rows: [{ x: 1 }] },
          },
        ],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      const pinButtons = screen.getAllByRole("button", { name: /pin result/i });
      expect(pinButtons).toHaveLength(2);
    });
  });

  // #268: display and pinnability are separate properties. A block with a
  // registered renderer displays even when it is not pinnable (d3 widgets);
  // pinnability only controls the pin affordance. Pre-fix, PortalMessage
  // used pinnability as its display filter and d3 blocks vanished.
  describe("registered non-pinnable blocks (d3)", () => {
    it("renders a registered d3 block without a pin affordance", () => {
      registerBlockRenderer("d3", (b) => (
        <div data-testid="d3-widget-stub">
          {String((b.content as { program: string }).program)}
        </div>
      ));
      const message = makeMessage({
        role: "assistant",
        blocks: [
          { type: "text", content: "Here is your chart:" },
          { type: "d3", content: { program: "api.d3;", rows: [{ x: 1 }] } },
        ],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      // The d3 block displays…
      expect(screen.getByTestId("d3-widget-stub")).toHaveTextContent("api.d3;");
      // …but only the text block offers a pin.
      expect(
        screen.getAllByRole("button", { name: /pin result/i })
      ).toHaveLength(1);
    });

    // #270: a persisted d3 block is rendered with its blockRef so the widget
    // can refresh itself against { messageId, blockIndex }.
    it("threads blockRef { messageId, blockIndex } to a persisted d3 block", () => {
      registerBlockRenderer("d3", (_b, ctx) => (
        <div data-testid="d3-blockref-stub">
          {`${ctx?.blockRef?.messageId}:${ctx?.blockRef?.blockIndex}`}
        </div>
      ));
      const message = makeMessage({
        id: "msg-42",
        role: "assistant",
        blocks: [
          { type: "text", content: "Here is your chart:" },
          { type: "d3", content: { program: "api.d3;", rows: [{ x: 1 }] } },
        ],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      // The d3 block is at index 1 of the message.
      expect(screen.getByTestId("d3-blockref-stub")).toHaveTextContent(
        "msg-42:1"
      );
    });

    it("still hides registered blocks with empty content", () => {
      registerBlockRenderer("d3", () => <div data-testid="d3-widget-stub" />);
      const message = makeMessage({
        role: "assistant",
        blocks: [{ type: "d3", content: {} }],
      });
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(screen.queryByTestId("d3-widget-stub")).not.toBeInTheDocument();
    });
  });

  describe("pin dialog", () => {
    it("opens the name dialog when a pin button is clicked", () => {
      const message = makeMessage();
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      expect(screen.getByText("Name this result")).toBeInTheDocument();
    });

    it("calls onPin with messageId, blockIndex, and name when confirmed", () => {
      const onPin = jest.fn(async () => {});
      const message = makeMessage();
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={onPin}
          onUnpin={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      fireEvent.change(screen.getByRole("textbox", { name: /name/i }), {
        target: { value: "My result" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^pin$/i }));
      expect(onPin).toHaveBeenCalledWith("msg-1", 0, "My result");
    });

    // #285: the confirm button used to be disabled on an empty name, which
    // gave no reason why. The house Form & Dialog Pattern submits and
    // explains instead — the button stays enabled and the field shows the
    // error. Behavior change, deliberate.
    it("blocks submission and explains when the name is empty", () => {
      const onPin = jest.fn(async () => {});
      const message = makeMessage();
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={onPin}
          onUnpin={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      const confirm = screen.getByRole("button", { name: /^pin$/i });
      expect(confirm).toBeEnabled();

      fireEvent.click(confirm);
      expect(onPin).not.toHaveBeenCalled();
      expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    });

    it("keeps the dialog open when the pin fails (#285)", async () => {
      const onPin = jest.fn(async () => {
        throw new Error("nope");
      });
      const message = makeMessage();
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={onPin}
          onUnpin={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      fireEvent.change(screen.getByRole("textbox", { name: /name/i }), {
        target: { value: "Will fail" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^pin$/i }));

      await waitFor(() => expect(onPin).toHaveBeenCalled());
      // Previously the dialog closed regardless of the outcome.
      expect(screen.getByText("Name this result")).toBeInTheDocument();
    });

    it("closes the dialog when the pin succeeds", async () => {
      const onPin = jest.fn(async () => {});
      const message = makeMessage();
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={new Map()}
          onPin={onPin}
          onUnpin={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /pin result/i }));
      fireEvent.change(screen.getByRole("textbox", { name: /name/i }), {
        target: { value: "Will succeed" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^pin$/i }));

      await waitFor(() =>
        expect(screen.queryByText("Name this result")).not.toBeInTheDocument()
      );
    });
  });

  describe("pinned state", () => {
    it("shows filled pin icon for a pinned block", () => {
      const message = makeMessage({
        blocks: [{ type: "text", content: "Pinned content" }],
      });
      const pinnedBlocks = new Map([["msg-1:0", "result-1"]]);
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={pinnedBlocks}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: /unpin result/i })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^pin result$/i })
      ).not.toBeInTheDocument();
    });

    it("calls onUnpin with portalResultId when unpin button is clicked", () => {
      const onUnpin = jest.fn();
      const message = makeMessage({
        blocks: [{ type: "text", content: "Pinned content" }],
      });
      const pinnedBlocks = new Map([["msg-1:0", "result-1"]]);
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={pinnedBlocks}
          onPin={jest.fn(async () => {})}
          onUnpin={onUnpin}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /unpin result/i }));
      expect(onUnpin).toHaveBeenCalledWith("result-1");
    });

    it("shows pin icon for unpinned blocks and unpin icon for pinned blocks in same message", () => {
      const message = makeMessage({
        blocks: [
          { type: "text", content: "Unpinned block" },
          { type: "text", content: "Pinned block" },
        ],
      });
      const pinnedBlocks = new Map([["msg-1:1", "result-2"]]);
      render(
        <PortalMessageUI
          message={message}
          pinnedBlocks={pinnedBlocks}
          onPin={jest.fn(async () => {})}
          onUnpin={jest.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: /^pin result$/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /unpin result/i })
      ).toBeInTheDocument();
    });
  });
});
