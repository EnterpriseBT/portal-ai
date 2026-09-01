import { jest } from "@jest/globals";

import type { RunningJobSummary } from "@portalai/core/contracts";

const { render, screen } = await import("./test-utils");
const { ConnectorInstanceLockAlertUI } =
  await import("../components/ConnectorInstanceLockAlert.component");

// Keep the `jest` import live so eslint doesn't trim it — used by the
// test runner's setup hooks for jest-dom matcher registration.
void jest;

function job(overrides: Partial<RunningJobSummary> = {}): RunningJobSummary {
  return {
    id: "job-1",
    type: "layout_plan_commit",
    status: "active",
    startedAt: 1_700_000_000_000,
    created: 1_700_000_000_000,
    ...overrides,
  };
}

describe("ConnectorInstanceLockAlertUI", () => {
  it("renders nothing when there are no running jobs", () => {
    const { container } = render(
      <ConnectorInstanceLockAlertUI runningJobs={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a singular alert title for a single layout_plan_commit job", () => {
    render(<ConnectorInstanceLockAlertUI runningJobs={[job()]} />);
    expect(screen.getByText(/Import is running/i)).toBeInTheDocument();
    // Singular verb form on the body too.
    expect(screen.getByText(/until this job finishes/i)).toBeInTheDocument();
  });

  it("joins multiple running jobs with 'and' and switches to plural", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[
          job({ id: "j1", type: "layout_plan_commit" }),
          job({ id: "j2", type: "connector_sync" }),
        ]}
      />
    );
    expect(
      screen.getByText(/Import and Sync are running/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/until these jobs finish/i)).toBeInTheDocument();
  });

  it("uses oxford-comma form when three or more jobs are listed", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[
          job({ id: "j1", type: "layout_plan_commit" }),
          job({ id: "j2", type: "connector_sync" }),
          job({ id: "j3", type: "revalidation" }),
        ]}
      />
    );
    expect(
      screen.getByText(/Import, Sync, and Revalidation are running/i)
    ).toBeInTheDocument();
  });

  it("falls back to the raw type string for unknown job types", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[job({ type: "future_kind" })]}
      />
    );
    expect(screen.getByText(/future_kind is running/i)).toBeInTheDocument();
  });
});

// ── Age line + stuck hint (#391) ─────────────────────────────────────

describe("ConnectorInstanceLockAlertUI — age + stuck hint (#391)", () => {
  it("shows 'started X ago' for a fresh job, with no stuck hint", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[job({ startedAt: Date.now() - 2 * 60_000 })]}
      />
    );
    expect(screen.getByText(/started 2 min ago/i)).toBeInTheDocument();
    expect(screen.queryByText(/may be stuck/i)).not.toBeInTheDocument();
  });

  it("adds the stuck hint and a View-job link once a job passes the hint threshold", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[
          job({ id: "job-stuck", startedAt: Date.now() - 20 * 60_000 }),
        ]}
      />
    );
    expect(screen.getByText(/may be stuck/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view job/i });
    expect(link).toHaveAttribute("href", "/jobs/job-stuck");
  });

  it("hints only the stale job in a mixed list", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[
          job({
            id: "fresh",
            type: "connector_sync",
            startedAt: Date.now() - 60_000,
          }),
          job({
            id: "old",
            type: "layout_plan_commit",
            startedAt: Date.now() - 60 * 60_000,
          }),
        ]}
      />
    );
    expect(screen.getAllByText(/may be stuck/i)).toHaveLength(1);
    expect(screen.getByRole("link", { name: /view job/i })).toHaveAttribute(
      "href",
      "/jobs/old"
    );
  });

  it("falls back to `created` when startedAt is null", () => {
    render(
      <ConnectorInstanceLockAlertUI
        runningJobs={[
          job({ startedAt: null, created: Date.now() - 5 * 60_000 }),
        ]}
      />
    );
    expect(screen.getByText(/started 5 min ago/i)).toBeInTheDocument();
  });
});
