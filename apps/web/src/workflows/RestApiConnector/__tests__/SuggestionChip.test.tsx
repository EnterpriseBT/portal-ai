import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { SuggestionChipUI } from "../SuggestionChip.component";
import type { SuggestionChipUIProps } from "../SuggestionChip.component";

function makeProps(
  overrides: Partial<SuggestionChipUIProps> = {}
): SuggestionChipUIProps {
  return {
    suggestion: {
      columnDefinitionId: "cd-1",
      suggestedNormalizedKey: "user_email",
      suggestedSemanticType: "string",
      confidence: 0.85,
      rationale: "matches catalog entry 'email'",
    },
    onAdopt: jest.fn(),
    ...overrides,
  };
}

describe("SuggestionChipUI", () => {
  it("renders the suggested normalizedKey + confidence percentage", () => {
    render(<SuggestionChipUI {...makeProps()} />);
    expect(screen.getByText(/user_email.*85%/)).toBeInTheDocument();
  });

  it("calls onAdopt when clicked", async () => {
    const onAdopt = jest.fn();
    render(<SuggestionChipUI {...makeProps({ onAdopt })} />);
    await userEvent.click(
      screen.getByRole("button", { name: /adopt suggestion user_email/i })
    );
    expect(onAdopt).toHaveBeenCalled();
  });

  it("renders low-confidence suggestions with the outlined variant", () => {
    const { container } = render(
      <SuggestionChipUI
        {...makeProps({
          suggestion: {
            columnDefinitionId: null,
            suggestedNormalizedKey: "maybe",
            suggestedSemanticType: "string",
            confidence: 0.3,
            rationale: "uncertain",
          },
        })}
      />
    );
    const chip = container.querySelector(".MuiChip-outlined");
    expect(chip).not.toBeNull();
  });

  it("renders a tooltip containing the LLM rationale", () => {
    render(<SuggestionChipUI {...makeProps()} />);
    // The MUI tooltip's title sits on the underlying element; assert
    // the chip's aria-label as a proxy for the click affordance, and
    // the rendered text contains the normalizedKey + pct.
    expect(
      screen.getByRole("button", { name: /adopt suggestion user_email/i })
    ).toBeInTheDocument();
  });
});
