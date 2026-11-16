import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { BulkFailuresTableBlockUI } =
  await import("../components/BulkFailuresTableBlock.component");

const content = {
  jobId: "job-1",
  failures: [
    {
      sourceKey: "row-7",
      error: { code: "BAD", message: "Bad value", recommendation: "Fix it" },
    },
  ],
};

// #794: a named table whose detail toggles report their state.
describe("BulkFailuresTableBlockUI", () => {
  it("names the table and the toggle column", () => {
    render(
      <BulkFailuresTableBlockUI
        content={content}
        onRetryFailedOnly={jest.fn()}
      />
    );
    expect(
      screen.getByRole("table", { name: "Failed records" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Details" })
    ).toBeInTheDocument();
  });

  it("toggles a row's details, reporting aria-expanded under a stable name", async () => {
    render(
      <BulkFailuresTableBlockUI
        content={content}
        onRetryFailedOnly={jest.fn()}
      />
    );
    const toggle = screen.getByRole("button", { name: "Details for row-7" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = document.getElementById(
      toggle.getAttribute("aria-controls") ?? ""
    );
    expect(details).toHaveTextContent("Fix it");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <BulkFailuresTableBlockUI
        content={content}
        onRetryFailedOnly={jest.fn()}
      />
    );
    await expectNoAxeViolations(container);
  });
});
