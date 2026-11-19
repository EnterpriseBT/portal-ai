/**
 * StoredResultNoticeUI (#1038): what a stored chart, table or map shows when
 * it has no data to draw. A result is never shown from a stored copy, so a
 * reader who lost access sees "no longer available", and a result with no
 * recipe to re-run says it isn't kept.
 */

import { screen } from "@testing-library/react";

import { expectNoAxeViolations, render } from "./test-utils";
import { StoredResultNoticeUI } from "../components/StoredResultNotice.component";

describe("StoredResultNoticeUI", () => {
  it("says a result is no longer available, as a status, under its title", async () => {
    const { container } = render(
      <StoredResultNoticeUI reason="unavailable" title="Contacts" />
    );

    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This result is no longer available to you."
    );
    await expectNoAxeViolations(container);
  });

  it("says a result with no recipe isn't kept, and how to see it again", async () => {
    const { container } = render(<StoredResultNoticeUI reason="not-kept" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "This result isn't kept after the conversation. Ask again to see it."
    );
    await expectNoAxeViolations(container);
  });
});
