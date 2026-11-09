import { render, screen } from "./test-utils";
import { RouterLink } from "../components/RouterLink.component";

// #794: core renders links with whatever component the app passes; this is
// the router's, taking MUI's `href` as TanStack's `to`.
describe("RouterLink", () => {
  it("renders an anchor to the href, with its children", () => {
    render(<RouterLink href="/entities/ent-1">Customers</RouterLink>);
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute(
      "href",
      "/entities/ent-1"
    );
  });
});
