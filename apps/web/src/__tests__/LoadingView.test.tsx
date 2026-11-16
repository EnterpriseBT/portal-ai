import { render, screen, expectNoAxeViolations } from "./test-utils";
import { LoadingView } from "../views/Loading.view";

describe("LoadingView Component", () => {
  it("names its spinner and gives the page an h1 (#797)", () => {
    render(<LoadingView />);
    expect(
      screen.getByRole("progressbar", { name: "Loading" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Loading" })
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<LoadingView />);
    await expectNoAxeViolations(container);
  });
});
