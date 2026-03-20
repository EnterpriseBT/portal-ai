import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ColumnDefinitionListResponsePayload } from "@portalai/core/contracts";
import type { ColumnDefinition } from "@portalai/core/models";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<
  ColumnDefinitionListResponsePayload,
  ApiError
>;

let currentListQuery: Partial<ListQuery> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    columnDefinitions: {
      list: () => currentListQuery,
    },
  },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { ColumnDefinitionListView } = await import(
  "../views/ColumnDefinitionList.view"
);

const makeColumnDefinition = (
  overrides: Partial<ColumnDefinition> = {}
): ColumnDefinition => ({
  id: "cd-1",
  organizationId: "org-1",
  key: "first_name",
  label: "First Name",
  type: "string",
  required: true,
  defaultValue: null,
  format: null,
  enumValues: null,
  description: null,
  created: 1735689600000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("ColumnDefinitionListView", () => {
  beforeEach(() => {
    currentListQuery = {};
  });

  it("should display loading state", () => {
    currentListQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should display column definition cards with mock data", () => {
    const cd1 = makeColumnDefinition({ id: "cd-1", label: "First Name", key: "first_name" });
    const cd2 = makeColumnDefinition({ id: "cd-2", label: "Email", key: "email", type: "string" });

    currentListQuery = {
      data: { columnDefinitions: [cd1, cd2], total: 2, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByText("First Name")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("should display empty state when no results", () => {
    currentListQuery = {
      data: { columnDefinitions: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByText("No column definitions found")).toBeInTheDocument();
  });

  it("should display error state", () => {
    currentListQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: new Error("Network error") as unknown as ApiError,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it("should render filter button for type filter", () => {
    currentListQuery = {
      data: { columnDefinitions: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByRole("button", { name: /Filter/ })).toBeInTheDocument();
  });

  it("should render sort button", () => {
    currentListQuery = {
      data: { columnDefinitions: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByRole("button", { name: /Sort/ })).toBeInTheDocument();
  });

  it("should display sort options when sort button is clicked", () => {
    currentListQuery = {
      data: { columnDefinitions: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    fireEvent.click(screen.getByRole("button", { name: /Sort/ }));
    expect(screen.getByText("Key")).toBeInTheDocument();
    expect(screen.getByText("Label")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("should render breadcrumbs with Dashboard link", () => {
    currentListQuery = {
      data: { columnDefinitions: [], total: 0, limit: 10, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<ColumnDefinitionListView />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    const breadcrumbNav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(breadcrumbNav).toBeInTheDocument();
    // "Column Definitions" appears in both breadcrumb and heading
    expect(screen.getAllByText("Column Definitions")).toHaveLength(2);
  });
});
