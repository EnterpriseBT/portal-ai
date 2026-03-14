import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { JobListResponsePayload } from "@mcp-ui/core/contracts";
import type { Job } from "@mcp-ui/core/models";
import type { JobStreamState } from "../utils/job-stream.util";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<JobListResponsePayload, ApiError>;

let currentListQuery: Partial<ListQuery> = {};
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
      list: () => currentListQuery,
    },
  },
}));

jest.unstable_mockModule("../utils/job-stream.util", () => ({
  useJobStream: () => currentStreamState,
}));

const { render, screen } = await import("./test-utils");
const { JobsView } = await import("../views/Jobs.view");

const makeJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  organizationId: "org-1",
  type: "system_check",
  status: "completed",
  progress: 100,
  metadata: {},
  result: null,
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

describe("JobsView", () => {
  beforeEach(() => {
    currentListQuery = {};
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

  it("should display the Jobs heading", () => {
    currentListQuery = {
      data: { jobs: [], total: 0, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<JobsView />);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
  });

  it("should display empty results when no jobs exist", () => {
    currentListQuery = {
      data: { jobs: [], total: 0, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<JobsView />);
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("should display job rows when jobs exist", () => {
    const job1 = makeJob({ id: "job-1", type: "system_check" });
    const job2 = makeJob({ id: "job-2", type: "file_upload", status: "pending" });

    currentListQuery = {
      data: { jobs: [job1, job2], total: 2, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<JobsView />);
    expect(screen.getByText("system_check")).toBeInTheDocument();
    expect(screen.getByText("file_upload")).toBeInTheDocument();
  });

  it("should show loading state", () => {
    currentListQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
    } as Partial<ListQuery>;

    render(<JobsView />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should display a StatusBadge for non-active jobs", () => {
    const job = makeJob({ status: "completed" });

    currentListQuery = {
      data: { jobs: [job], total: 1, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<JobsView />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("should display a progress bar for active jobs", () => {
    const job = makeJob({ status: "active", progress: 45 });

    currentListQuery = {
      data: { jobs: [job], total: 1, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<JobsView />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("should show live stream progress for active jobs", () => {
    const job = makeJob({ status: "active", progress: 30 });

    currentListQuery = {
      data: { jobs: [job], total: 1, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    currentStreamState = {
      jobId: "job-1",
      status: "active",
      progress: 72,
      error: null,
      result: null,
      startedAt: 1710000000000,
      completedAt: null,
      connectionStatus: "connected",
    };

    render(<JobsView />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("should show updated status badge when stream reports completion", () => {
    const job = makeJob({ status: "active", progress: 80 });

    currentListQuery = {
      data: { jobs: [job], total: 1, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    currentStreamState = {
      jobId: "job-1",
      status: "completed",
      progress: 100,
      error: null,
      result: null,
      startedAt: 1710000000000,
      completedAt: 1710000060000,
      connectionStatus: "closed",
    };

    render(<JobsView />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
