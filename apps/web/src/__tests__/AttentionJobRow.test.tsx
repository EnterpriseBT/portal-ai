import { JOB_TYPE_LABELS } from "@portalai/core/models";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { AttentionJobRowUI } =
  await import("../components/AttentionJobRow.component");

const job = {
  id: "j1",
  type: "connector_sync" as const,
  status: "failed" as const,
  where: "Salesforce",
  updated: Date.now() - 2 * 3600_000,
};

describe("AttentionJobRowUI", () => {
  it("names the job by its label and where it ran, linking to it", async () => {
    const { container } = render(<AttentionJobRowUI job={job} />);
    const name = `${JOB_TYPE_LABELS.connector_sync} on Salesforce`;
    expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name })).toHaveAttribute(
      "href",
      "/jobs/j1"
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("uses the label alone without a location", () => {
    render(
      <AttentionJobRowUI
        job={{
          ...job,
          type: "layout_plan_commit",
          where: null,
          status: "awaiting_confirmation",
        }}
      />
    );
    expect(
      screen.getByRole("link", { name: JOB_TYPE_LABELS.layout_plan_commit })
    ).toBeInTheDocument();
    expect(screen.getByText("Needs confirmation")).toBeInTheDocument();
  });
});
