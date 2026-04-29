import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
// expect/describe/it/beforeEach all come from the Jest globals so jest-dom
// matchers (toBeInTheDocument, toBeDisabled, etc.) are present on `expect`.
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { AuthorizeStep } from "../AuthorizeStep.component";
import type { AuthorizeStepUIProps } from "../AuthorizeStep.component";

function makeProps(
  overrides: Partial<AuthorizeStepUIProps> = {}
): AuthorizeStepUIProps {
  return {
    state: "idle",
    onConnect: jest.fn(),
    ...overrides,
  };
}

describe("AuthorizeStep", () => {
  it("renders the Connect CTA in the idle state", () => {
    render(<AuthorizeStep {...makeProps({ state: "idle" })} />);
    expect(
      screen.getByRole("button", { name: /connect google sheets/i })
    ).toBeInTheDocument();
  });

  it("disables the CTA + shows a spinner in the connecting state", () => {
    render(<AuthorizeStep {...makeProps({ state: "connecting" })} />);
    const button = screen.getByRole("button", {
      name: /connect google sheets/i,
    });
    expect(button).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders the connected account email in the authorized state", () => {
    render(
      <AuthorizeStep
        {...makeProps({
          state: "authorized",
          accountIdentity: "alice@example.com",
        })}
      />
    );
    expect(screen.getByText(/alice@example.com/i)).toBeInTheDocument();
  });

  it("falls back to a generic 'Connected' label when accountIdentity is null", () => {
    render(
      <AuthorizeStep
        {...makeProps({ state: "authorized", accountIdentity: null })}
      />
    );
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("renders an error banner with a retry button in the error state", () => {
    render(
      <AuthorizeStep
        {...makeProps({
          state: "error",
          error: "Authorization was cancelled",
        })}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /authorization was cancelled/i
    );
    expect(
      screen.getByRole("button", { name: /retry|try again|connect/i })
    ).toBeInTheDocument();
  });

  it("calls onConnect when the CTA is clicked from idle state", async () => {
    const onConnect = jest.fn();
    render(
      <AuthorizeStep {...makeProps({ state: "idle", onConnect })} />
    );
    const button = screen.getByRole("button", {
      name: /connect google sheets/i,
    });
    await userEvent.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("calls onConnect when retry is clicked from error state", async () => {
    const onConnect = jest.fn();
    render(
      <AuthorizeStep
        {...makeProps({ state: "error", error: "boom", onConnect })}
      />
    );
    const button = screen.getByRole("button", {
      name: /retry|try again|connect/i,
    });
    await userEvent.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

});
