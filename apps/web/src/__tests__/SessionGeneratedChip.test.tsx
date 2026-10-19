import { render, screen } from "./test-utils";
import { SessionGeneratedChipUI } from "../components/SessionGeneratedChip.component";

// #641: the provenance badge for an object an agent created in a portal
// session. Plain text, no link: the portal may be unreadable to the viewer.
describe("SessionGeneratedChipUI (#641)", () => {
  it("names where the object came from, without linking anywhere", () => {
    render(<SessionGeneratedChipUI />);
    expect(screen.getByText("Created in a portal session")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
