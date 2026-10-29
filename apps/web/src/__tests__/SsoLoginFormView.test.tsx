import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "./test-utils";
import {
  SsoLoginFormUI,
  type SsoLoginFormUIProps,
} from "../components/SsoLoginForm.component";

const renderForm = (props: Partial<SsoLoginFormUIProps> = {}) => {
  const onSubmit = jest.fn();
  const onBack = jest.fn();
  render(
    <SsoLoginFormUI
      onSubmit={onSubmit}
      onBack={onBack}
      pending={false}
      notConfigured={false}
      serverError={null}
      {...props}
    />
  );
  return { onSubmit, onBack };
};

describe("SsoLoginFormUI (#916)", () => {
  it("auto-focuses a required work email field", async () => {
    renderForm();
    const field = screen.getByLabelText(/work email/i);

    expect(field).toBeRequired();
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("submits a valid email on Enter", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    const field = screen.getByLabelText(/work email/i);
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, "jo@acme.com{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("jo@acme.com");
  });

  it("blocks an invalid email with a field error", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    const field = screen.getByLabelText(/work email/i);

    await user.type(field, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Enter a valid email address")
    ).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("calls onBack from Back", async () => {
    const user = userEvent.setup();
    const { onBack } = renderForm();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("explains an unconfigured domain", () => {
    renderForm({ notConfigured: true });

    expect(
      screen.getByText(
        "Single sign-on isn't set up for that email domain. Sign in with Google instead."
      )
    ).toBeInTheDocument();
  });

  it("shows a server error through FormAlert", () => {
    renderForm({
      serverError: {
        message: "Too many requests.",
        code: "SSO_DISCOVERY_RATE_LIMITED",
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests.");
  });

  it("disables Continue while pending", () => {
    renderForm({ pending: true });

    expect(screen.getByRole("button", { name: /continu/i })).toBeDisabled();
  });
});
