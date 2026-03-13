import { jest } from "@jest/globals";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import type {
  JobGetResponsePayload,
  JobCancelResponsePayload,
} from "@mcp-ui/core/contracts";
import type { Job } from "@mcp-ui/core/models";
import type { JobStreamState } from "../utils/job-stream.util";
import type { ApiError } from "../utils";

type GetQuery = UseQueryResult<JobGetResponsePayload, ApiError>;

let currentGetQuery: Partial<GetQuery> = {};
let currentCancelMutation: Partial<UseMutationResult<JobCancelResponsePayload, ApiError, void>> = {};
let currentStreamState: JobStreamState = {
  jobId: null,
  status: null,
  progress: 0,
  error: null,
  result: null,
  startedAt: null,
  completedAt: null,
  connectionStatus: "idle",
};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    jobs: {
      get: () => currentGetQuery,
      cancel: () => currentCancelMutation,
    },
  },
}));

jest.unstable_mockModule("../utils/job-stream.util", () => ({
  useJobStream: () => currentStreamState,
}));

const { render, screen } = await import("./test-utils");
const { JobDetailView } = await import("../views/JobDetail.view");

const makeJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  organizationId: "org-1",
  type: "system_check",
  status: "completed",
  progress: 100,
  metadata: {},
  result: { status: "healthy", checks: {}, durationMs: 500 },
  error: null,
  startedAt: 1710000000000,
  completedAt: 1710000060000,
  bullJobId: "bull-1",
  attempts: 1,
  maxAttempts: 3,
  created: 1710000000000,
  createdBy: "user-1",
  updated: 1710000060000,
  updatedBy: "user-1",
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("JobDetailView", () => {
  beforeEach(() => {
    currentGetQuery = {};
    currentCancelMutation = {
      mutate: jest.fn() as unknown as UseMutationResult<JobCancelResponsePayload, ApiError, void>["mutate"],
      isPending: false,
    } as Partial<UseMutationResult<JobCancelResponsePayload, ApiError, void>>;
    currentStreamState = {
      jobId: null,
      status: null,
      progress: 0,
      error: null,
      result: null,
      startedAt: null,
      completedAt: null,
      connectionStatus: "idle",
    };
  });

  it("should display loading state when query is loading", () => {
    currentGetQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should display job type as heading", () => {
    const job = makeJob();
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(
      screen.getByRole("heading", { name: "system_check" })
    ).toBeInTheDocument();
  });

  it("should display status badge", () => {
    const job = makeJob({ status: "completed" });
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("should display job details", () => {
    const job = makeJob();
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("should not show Cancel button for terminal jobs", () => {
    const job = makeJob({ status: "completed" });
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(screen.queryByText("Cancel Job")).not.toBeInTheDocument();
  });

  it("should show Cancel button for active jobs", () => {
    const job = makeJob({ status: "active", progress: 50 });
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentStreamState = {
      jobId: "job-1",
      status: "active",
      progress: 50,
      error: null,
      result: null,
      startedAt: 1710000000000,
      completedAt: null,
      connectionStatus: "connected",
    };

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByText("Cancel Job")).toBeInTheDocument();
  });

  it("should show progress bar for active jobs with stream data", () => {
    const job = makeJob({ status: "active", progress: 30 });
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;
    currentStreamState = {
      jobId: "job-1",
      status: "active",
      progress: 60,
      error: null,
      result: null,
      startedAt: 1710000000000,
      completedAt: null,
      connectionStatus: "connected",
    };

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // Progress bar label and detail row both show the percentage
    expect(screen.getAllByText("60%").length).toBeGreaterThanOrEqual(1);
  });

  it("should display error section when job has error", () => {
    const job = makeJob({
      status: "failed",
      error: "Connection timed out",
    });
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Connection timed out")).toBeInTheDocument();
  });

  it("should display result section when job has result", () => {
    const job = makeJob({
      result: { recordsSynced: 42 },
    });
    currentGetQuery = {
      data: { job },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<GetQuery>;

    render(<JobDetailView jobId="job-1" />);
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText(/recordsSynced/)).toBeInTheDocument();
  });
});
