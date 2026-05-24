import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { EndpointColumnReviewUI } from "../EndpointColumnReview.component";
import type { EndpointColumnReviewUIProps } from "../EndpointColumnReview.component";

function makeProps(
  overrides: Partial<EndpointColumnReviewUIProps> = {}
): EndpointColumnReviewUIProps {
  return {
    endpointKey: "users",
    endpointLabel: "Users",
    state: { kind: "idle" },
    rows: [],
    errors: {},
    onChange: jest.fn(),
    onAdoptSuggestion: jest.fn(),
    onAddRow: jest.fn(),
    onRemoveRow: jest.fn(),
    ...overrides,
  };
}

describe("EndpointColumnReviewUI — state rendering", () => {
  it("renders the loading spinner when state.kind === 'loading'", () => {
    render(
      <EndpointColumnReviewUI {...makeProps({ state: { kind: "loading" } })} />
    );
    expect(screen.getByText(/probing endpoint/i)).toBeInTheDocument();
  });

  it("renders the success state with the degradation banner + records-scanned hint", () => {
    render(
      <EndpointColumnReviewUI
        {...makeProps({
          state: {
            kind: "success",
            degradation: "llm-failed",
            recordsScanned: 12,
          },
        })}
      />
    );
    expect(screen.getByText(/AI suggestions unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/scanned 12 records/i)).toBeInTheDocument();
  });

  it("renders the error state with a FormAlert", () => {
    render(
      <EndpointColumnReviewUI
        {...makeProps({
          state: {
            kind: "error",
            serverError: { code: "REST_API_AUTH_FAILED", message: "401" },
          },
        })}
      />
    );
    expect(screen.getByText(/REST_API_AUTH_FAILED/)).toBeInTheDocument();
    expect(screen.getByText(/didn.t complete/i)).toBeInTheDocument();
  });

  it("renders the empty-records state hint", () => {
    render(
      <EndpointColumnReviewUI {...makeProps({ state: { kind: "empty" } })} />
    );
    expect(screen.getByText(/probe returned no records/i)).toBeInTheDocument();
  });

  it("renders the idle-state hint when no probe has run yet", () => {
    render(<EndpointColumnReviewUI {...makeProps()} />);
    expect(
      screen.getByText(/probe runs after the connector is saved/i)
    ).toBeInTheDocument();
  });
});

describe("EndpointColumnReviewUI — Re-probe button", () => {
  it("renders the Re-probe button when onReprobe is provided", () => {
    render(<EndpointColumnReviewUI {...makeProps({ onReprobe: jest.fn() })} />);
    expect(
      screen.getByRole("button", { name: /re-probe users/i })
    ).toBeInTheDocument();
  });

  it("disables Re-probe when reprobeDisabled is true", () => {
    render(
      <EndpointColumnReviewUI
        {...makeProps({
          onReprobe: jest.fn(),
          reprobeDisabled: true,
          reprobeDisabledHint: "Save first",
        })}
      />
    );
    expect(
      screen.getByRole("button", { name: /re-probe users/i })
    ).toBeDisabled();
  });

  it("calls onReprobe when clicked", async () => {
    const onReprobe = jest.fn();
    render(<EndpointColumnReviewUI {...makeProps({ onReprobe })} />);
    await userEvent.click(screen.getByRole("button", { name: /re-probe users/i }));
    expect(onReprobe).toHaveBeenCalled();
  });
});
