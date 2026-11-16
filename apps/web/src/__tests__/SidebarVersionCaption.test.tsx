import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { render, screen, expectNoAxeViolations } from "./test-utils";
import { SidebarVersionCaptionUI } from "../components/SidebarVersionCaption.component";

describe("SidebarVersionCaptionUI (#797)", () => {
  it("is a button, named by its text and what it opens", async () => {
    const onClick = jest.fn();
    render(
      <SidebarVersionCaptionUI
        collapsed={false}
        year={2026}
        onClick={onClick}
      />
    );
    const button = screen.getByRole("button", { name: /app version/i });
    expect(button).toHaveTextContent("Portalsai © 2026");
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shortens when collapsed", () => {
    render(
      <SidebarVersionCaptionUI collapsed year={2026} onClick={jest.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /app version/i })
    ).toHaveTextContent("© 2026");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <SidebarVersionCaptionUI
        collapsed={false}
        year={2026}
        onClick={jest.fn()}
      />
    );
    await expectNoAxeViolations(container);
  });
});
