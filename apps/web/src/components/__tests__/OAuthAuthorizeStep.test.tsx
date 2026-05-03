import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import GoogleIcon from "@mui/icons-material/Google";
import MicrosoftIcon from "@mui/icons-material/Microsoft";

import { render, screen } from "../../__tests__/test-utils";

import { OAuthAuthorizeStep } from "../OAuthAuthorizeStep.component";
import type { OAuthAuthorizeStepUIProps } from "../OAuthAuthorizeStep.component";

const GOOGLE_DEFAULTS = {
  providerLabel: "Google Sheets",
  providerIcon: <GoogleIcon data-testid="google-icon" />,
  scopesDescription:
    "Authorize Portal.ai to read your Google Drive and Sheets. We only ever request read access.",
};

const MSFT_DEFAULTS = {
  providerLabel: "Microsoft 365",
  providerIcon: <MicrosoftIcon data-testid="microsoft-icon" />,
  scopesDescription:
    "Authorize Portal.ai to read your Microsoft 365 Excel files in OneDrive. Read access only.",
};

function makeProps(
  overrides: Partial<OAuthAuthorizeStepUIProps> = {},
  defaults = GOOGLE_DEFAULTS
): OAuthAuthorizeStepUIProps {
  return {
    state: "idle",
    onConnect: jest.fn(),
    ...defaults,
    ...overrides,
  };
}

describe("OAuthAuthorizeStep — slug-agnostic behavior (Google fixtures)", () => {
  it("renders the `Connect ${providerLabel}` CTA in the idle state", () => {
    render(<OAuthAuthorizeStep {...makeProps({ state: "idle" })} />);
    expect(
      screen.getByRole("button", { name: /connect google sheets/i })
    ).toBeInTheDocument();
  });

  it("renders the providerIcon in the idle state", () => {
    render(<OAuthAuthorizeStep {...makeProps({ state: "idle" })} />);
    expect(screen.getByTestId("google-icon")).toBeInTheDocument();
  });

  it("renders the scopesDescription as the body copy", () => {
    render(<OAuthAuthorizeStep {...makeProps({ state: "idle" })} />);
    expect(
      screen.getByText(/authorize portal\.ai to read your google drive/i)
    ).toBeInTheDocument();
  });

  it("disables the CTA + shows a spinner in the connecting state", () => {
    render(<OAuthAuthorizeStep {...makeProps({ state: "connecting" })} />);
    const button = screen.getByRole("button", {
      name: /connect google sheets/i,
    });
    expect(button).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders the connected account identity in the authorized state", () => {
    render(
      <OAuthAuthorizeStep
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
      <OAuthAuthorizeStep
        {...makeProps({ state: "authorized", accountIdentity: null })}
      />
    );
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("renders an error banner with a retry button in the error state", () => {
    render(
      <OAuthAuthorizeStep
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
    render(<OAuthAuthorizeStep {...makeProps({ state: "idle", onConnect })} />);
    const button = screen.getByRole("button", {
      name: /connect google sheets/i,
    });
    await userEvent.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("calls onConnect when retry is clicked from error state", async () => {
    const onConnect = jest.fn();
    render(
      <OAuthAuthorizeStep
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

describe("OAuthAuthorizeStep — Microsoft branding", () => {
  it("renders the Microsoft CTA copy and icon", () => {
    render(
      <OAuthAuthorizeStep {...makeProps({ state: "idle" }, MSFT_DEFAULTS)} />
    );
    expect(
      screen.getByRole("button", { name: /connect microsoft 365/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("microsoft-icon")).toBeInTheDocument();
    expect(
      screen.getByText(/authorize portal\.ai to read your microsoft 365 excel/i)
    ).toBeInTheDocument();
  });
});
