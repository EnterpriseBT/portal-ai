import { render, screen, expectNoAxeViolations } from "./test-utils";
import { PublicLayout } from "../layouts/Public.layout";

describe("PublicLayout Component", () => {
  it("should match snapshot", () => {
    const { container } = render(
      <PublicLayout>
        <div>Test Content</div>
      </PublicLayout>
    );

    expect(container.firstChild).toMatchSnapshot();
  });

  describe("landmarks (#797)", () => {
    const renderPage = () =>
      render(
        <PublicLayout>
          <h1>Sign in</h1>
        </PublicLayout>
      );

    it("has a banner and a main holding the page, behind a skip link", () => {
      renderPage();
      expect(screen.getByRole("banner")).toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
      expect(
        screen.getByRole("link", { name: "Skip to main content" })
      ).toBeInTheDocument();
    });

    it("puts no heading before the page's", () => {
      renderPage();
      expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
        "Sign in",
      ]);
    });

    it("has no axe violations", async () => {
      const { container } = renderPage();
      await expectNoAxeViolations(container);
    });
  });
});
