import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import { ChatWindowUI, CHAT_INPUT_PLACEHOLDER } from "../components/ChatWindow.component";

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
  onSubmit: jest.fn(),
  onReset: jest.fn(),
  onCancel: jest.fn(),
  onExit: jest.fn(),
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
        screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)
      ).toBeInTheDocument();
    });

    it("renders Submit, Reset, Cancel, and Exit buttons", () => {
      render(<ChatWindowUI {...createProps()} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
    });

    it("renders children in the content area", () => {
      render(
        <ChatWindowUI {...createProps()}>
          <div>Chat content</div>
        </ChatWindowUI>
      );
      expect(screen.getByText("Chat content")).toBeInTheDocument();
    });

    it("displays typed text in the text field", () => {
      render(<ChatWindowUI {...createProps()} />);
      const textarea = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
      fireEvent.change(textarea, { target: { value: "Hello world" } });
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
    });

    it("calls onSubmit with value when Submit button is clicked", () => {
      const props = createProps();
      render(<ChatWindowUI {...props} />);
      fireEvent.change(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER), {
        target: { value: "hello" },
      });
      fireEvent.click(screen.getByRole("button", { name: /submit/i }));
      expect(props.onSubmit).toHaveBeenCalledWith("hello");
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

    it("calls onExit when Exit button is clicked", () => {
      const props = createProps();
      render(<ChatWindowUI {...props} />);
      fireEvent.click(screen.getByRole("button", { name: /exit/i }));
      expect(props.onExit).toHaveBeenCalledTimes(1);
    });
  });

  describe("Disabled State", () => {
    it("disables the text field when disabled", () => {
      render(<ChatWindowUI {...createProps({ disabled: true })} />);
      expect(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER)).toBeDisabled();
    });

    it("disables Submit when disabled is true", () => {
      render(<ChatWindowUI {...createProps({ disabled: true })} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    });

    it("disables Submit when value is empty", () => {
      render(<ChatWindowUI {...createProps()} />);
      expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    });

    it("enables Submit when value is non-empty and not disabled", () => {
      render(<ChatWindowUI {...createProps()} />);
      fireEvent.change(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER), {
        target: { value: "hello" },
      });
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
    it("calls onSubmit with value when Enter is pressed without Shift", () => {
      const props = createProps();
      render(<ChatWindowUI {...props} />);
      const textarea = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
      fireEvent.change(textarea, { target: { value: "hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
      expect(props.onSubmit).toHaveBeenCalledWith("hello");
    });

    it("does not call onSubmit when Shift+Enter is pressed", () => {
      const props = createProps();
      render(<ChatWindowUI {...props} />);
      const textarea = screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER);
      fireEvent.change(textarea, { target: { value: "hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("Mobile Layout", () => {
    beforeEach(() => {
      mockBreakpoint("mobile");
    });

    it("renders icon buttons instead of text buttons", () => {
      render(<ChatWindowUI {...createProps()} />);
      expect(screen.queryByText("Submit")).not.toBeInTheDocument();
      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    });

    it("calls onSubmit on mobile submit icon click", () => {
      const props = createProps();
      const { container } = render(<ChatWindowUI {...props} />);
      fireEvent.change(screen.getByPlaceholderText(CHAT_INPUT_PLACEHOLDER), {
        target: { value: "hello" },
      });
      const sendIcon = container.querySelector("[data-testid='SendIcon']")!;
      fireEvent.click(sendIcon.closest("button")!);
      expect(props.onSubmit).toHaveBeenCalledWith("hello");
    });

    it("calls onReset on mobile reset icon click", () => {
      const props = createProps();
      const { container } = render(<ChatWindowUI {...props} />);
      const refreshIcon = container.querySelector("[data-testid='RefreshIcon']")!;
      fireEvent.click(refreshIcon.closest("button")!);
      expect(props.onReset).toHaveBeenCalledTimes(1);
    });

    it("calls onExit on mobile exit icon click", () => {
      const props = createProps();
      const { container } = render(<ChatWindowUI {...props} />);
      const backIcon = container.querySelector("[data-testid='ArrowBackIcon']")!;
      fireEvent.click(backIcon.closest("button")!);
      expect(props.onExit).toHaveBeenCalledTimes(1);
    });
  });
});
