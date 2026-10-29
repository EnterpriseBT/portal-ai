import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { render, screen } from "./test-utils";
import { NotInvitedViewUI } from "../views/NotInvited.view";

describe("NotInvitedViewUI (#916)", () => {
  it("explains that an invitation is required", () => {
    render(<NotInvitedViewUI onTryAgain={jest.fn()} onSignOut={jest.fn()} />);

    expect(
      screen.getByRole("heading", { name: "You need an invitation" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ask someone in your organization to invite/i)
    ).toBeInTheDocument();
  });

  it("calls onTryAgain from Try again", async () => {
    const user = userEvent.setup();
    const onTryAgain = jest.fn();
    render(<NotInvitedViewUI onTryAgain={onTryAgain} onSignOut={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("calls onSignOut from Sign out", async () => {
    const user = userEvent.setup();
    const onSignOut = jest.fn();
    render(<NotInvitedViewUI onTryAgain={jest.fn()} onSignOut={onSignOut} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
