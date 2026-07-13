import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { render } from "../../../__tests__/test-utils";

import { TransformSuggesterUI } from "../TransformSuggester.component";

describe("TransformSuggesterUI — render shape", () => {
  it("renders the prompt-hint textarea + the Suggest button", () => {
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
      />
    );

    expect(
      screen.getByRole("textbox", { name: /suggestion hint/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^suggest$/i })
    ).toBeInTheDocument();
  });

  it("renders the placeholder hint copy on the textarea", () => {
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
      />
    );
    const textarea = screen.getByRole("textbox", { name: /suggestion hint/i });
    expect(textarea).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Describe what records you want")
    );
  });

  it("renders the current promptHint value", () => {
    render(
      <TransformSuggesterUI
        promptHint="just id and email"
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
      />
    );
    expect(
      screen.getByRole("textbox", { name: /suggestion hint/i })
    ).toHaveValue("just id and email");
  });

  it("does not render a FormAlert when serverError is null", () => {
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
        serverError={null}
      />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("button has type='button' so it does not submit the surrounding form", () => {
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
      />
    );
    expect(screen.getByRole("button", { name: /^suggest$/i })).toHaveAttribute(
      "type",
      "button"
    );
  });
});

describe("TransformSuggesterUI — interactions", () => {
  it("fires onPromptHintChange when the user types", () => {
    const onPromptHintChange = jest.fn();
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={onPromptHintChange}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
      />
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: /suggestion hint/i }),
      { target: { value: "one row per order line item" } }
    );
    expect(onPromptHintChange).toHaveBeenCalledWith(
      "one row per order line item"
    );
  });

  it("fires onSuggest when the button is clicked", async () => {
    const onSuggest = jest.fn();
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={onSuggest}
        isSuggesting={false}
        disabled={false}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^suggest$/i }));
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });
});

describe("TransformSuggesterUI — pending state", () => {
  it("shows 'Suggesting…' label and disables the button when isSuggesting=true", () => {
    render(
      <TransformSuggesterUI
        promptHint="hint"
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={true}
        disabled={false}
      />
    );
    const button = screen.getByRole("button", { name: /suggesting/i });
    expect(button).toBeDisabled();
  });
});

describe("TransformSuggesterUI — disabled state", () => {
  it("disables the Suggest button when disabled=true and shows the disabledReason", async () => {
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={true}
        disabledReason="Run Preview first to capture a sample response."
      />
    );

    const button = screen.getByRole("button", { name: /^suggest$/i });
    expect(button).toBeDisabled();

    // MUI wraps the disabled button in a span carrying aria-describedby
    // → the tooltip is reachable by hover; assert the reason text is
    // present in the DOM (Tooltip uses MUI Popper, which renders the
    // tooltip after a hover — `findByRole("tooltip")` waits for it).
    await userEvent.hover(button.parentElement ?? button);
    expect(await screen.findByText(/run preview first/i)).toBeInTheDocument();
  });
});

describe("TransformSuggesterUI — serverError", () => {
  it("renders a FormAlert with the error message + code when serverError is set", () => {
    render(
      <TransformSuggesterUI
        promptHint=""
        onPromptHintChange={jest.fn()}
        onSuggest={jest.fn()}
        isSuggesting={false}
        disabled={false}
        serverError={{
          message: "Haiku timed out",
          code: "REST_API_TRANSFORM_SUGGEST_FAILED",
        }}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/haiku timed out/i);
    expect(alert).toHaveTextContent(/rest_api_transform_suggest_failed/i);
  });
});
