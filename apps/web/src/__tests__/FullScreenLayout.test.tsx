import { render, screen, expectNoAxeViolations } from "./test-utils";
import { FullScreenLayout } from "../layouts/FullScreen.layout";

describe("FullScreenLayout (#797)", () => {
  it("puts its content in the page's main landmark, behind a skip link", () => {
    render(
      <FullScreenLayout>
        <h1>Portal</h1>
      </FullScreenLayout>
    );
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toContainElement(
      screen.getByRole("heading", { name: "Portal" })
    );
    expect(
      screen.getByRole("link", { name: "Skip to main content" })
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <FullScreenLayout>
        <h1>Portal</h1>
      </FullScreenLayout>
    );
    await expectNoAxeViolations(container);
  });
});
