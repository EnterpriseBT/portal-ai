import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import { ChatWindowUI } from "../components/ChatWindow.component";

const mockBreakpoint = (breakpoint: "mobile" | "desktop") => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => {
      let matches = false;
      if (breakpoint === "mobile") {
        matches =
          query.includes("max-width") && !query.includes("min-width");
      } else if (breakpoint === "desktop") {
        matches =
          query.includes("min-width") && !query.includes("max-width");
      }
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
};

const resetMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

const createProps = (overrides = {}) => ({
  value: "",
  onChange: jest.fn(),
  onSubmit: jest.fn(),
  onReset: jest.fn(),
  onCancel: jest.fn(),
  ...overrides,
});

describe("ChatWindowUI", () => {
  beforeEach(() => {
    mockBreakpoint("desktop");
  });

  afterEach(() => {
    resetMatchMedia();
  });

  describe("Desktop Layout", () => {
    it("renders the text input with placeholder", () => {
      render(<ChatWindowUI {...createProps()} />);
      expect(
        screen.getByPlaceholderText("Type a message...")
      ).toBeInTheDocument();
    });

    it("renders Submit, Reset, and Cancel buttons", () => {
      render(<ChatWindowUI {...createProps()} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    it("renders children in the content area", () => {
      render(
        <ChatWindowUI {...createProps()}>
          <div>Chat content</div>
        </ChatWindowUI>
      );
      expect(screen.getByText("Chat content")).toBeInTheDocument();
    });

    it("displays the current value in the text field", () => {
      render(<ChatWindowUI {...createProps({ value: "Hello world" })} />);
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
    });

    it("calls onChange when typing", () => {
      const props = createProps();
      render(<ChatWindowUI {...props} />);
      fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
        target: { value: "test" },
      });
      expect(props.onChange).toHaveBeenCalledWith("test");
    });

    it("calls onSubmit when Submit button is clicked", () => {
      const props = createProps({ value: "hello" });
      render(<ChatWindowUI {...props} />);
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("calls onReset when Reset button is clicked", () => {
      const props = createProps();
      render(<ChatWindowUI {...props} />);
      fireEvent.click(screen.getByRole("button", { name: /reset/i }));
      expect(props.onReset).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when Cancel button is clicked", () => {
      const props = createProps({ disabled: true });
      render(<ChatWindowUI {...props} />);
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(props.onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("Disabled State", () => {
    it("disables the text field when disabled", () => {
      render(<ChatWindowUI {...createProps({ disabled: true })} />);
      expect(screen.getByPlaceholderText("Type a message...")).toBeDisabled();
    });

    it("disables Submit when disabled is true", () => {
      render(
        <ChatWindowUI {...createProps({ value: "hello", disabled: true })} />
      );
      expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    });

    it("disables Submit when value is empty", () => {
      render(<ChatWindowUI {...createProps({ value: "" })} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    });

    it("disables Submit when value is whitespace only", () => {
      render(<ChatWindowUI {...createProps({ value: "   " })} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    });

    it("enables Submit when value is non-empty and not disabled", () => {
      render(<ChatWindowUI {...createProps({ value: "hello" })} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled();
    });

    it("disables Cancel when not disabled (nothing to cancel)", () => {
      render(<ChatWindowUI {...createProps({ disabled: false })} />);
      expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    });

    it("enables Cancel when disabled (request in progress)", () => {
      render(<ChatWindowUI {...createProps({ disabled: true })} />);
      expect(screen.getByRole("button", { name: /cancel/i })).toBeEnabled();
    });
  });

  describe("Keyboard Interaction", () => {
    it("calls onSubmit when Enter is pressed without Shift", () => {
      const props = createProps({ value: "hello" });
      render(<ChatWindowUI {...props} />);
      fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), {
        key: "Enter",
        shiftKey: false,
      });
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("does not call onSubmit when Shift+Enter is pressed", () => {
      const props = createProps({ value: "hello" });
      render(<ChatWindowUI {...props} />);
      fireEvent.keyDown(screen.getByPlaceholderText("Type a message..."), {
        key: "Enter",
        shiftKey: true,
      });
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("Mobile Layout", () => {
    beforeEach(() => {
      mockBreakpoint("mobile");
    });

    it("renders icon buttons instead of text buttons", () => {
      const { container } = render(
        <ChatWindowUI {...createProps({ value: "hello" })} />
      );
      // Desktop text labels should not appear
      expect(screen.queryByText("Submit")).not.toBeInTheDocument();
      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
      // Should have icon buttons (Send, Refresh, Close icons)
      expect(container.querySelector("[data-testid='SendIcon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='RefreshIcon']")).toBeInTheDocument();
      expect(container.querySelector("[data-testid='CloseIcon']")).toBeInTheDocument();
    });

    it("calls onSubmit on mobile submit icon click", () => {
      const props = createProps({ value: "hello" });
      const { container } = render(<ChatWindowUI {...props} />);
      const sendIcon = container.querySelector("[data-testid='SendIcon']")!;
      fireEvent.click(sendIcon.closest("button")!);
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("calls onReset on mobile reset icon click", () => {
      const props = createProps();
      const { container } = render(<ChatWindowUI {...props} />);
      const refreshIcon = container.querySelector("[data-testid='RefreshIcon']")!;
      fireEvent.click(refreshIcon.closest("button")!);
      expect(props.onReset).toHaveBeenCalledTimes(1);
    });
  });
});
