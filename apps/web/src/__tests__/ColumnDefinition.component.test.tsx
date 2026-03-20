import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import type { ColumnDefinition } from "@portalai/core/models";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<
  ColumnDefinitionListResponsePayload,
  ApiError
>;
type GetQuery = UseQueryResult<ColumnDefinitionGetResponsePayload, ApiError>;

let currentListQuery: Partial<ListQuery> = {};
let currentGetQuery: Partial<GetQuery> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    columnDefinitions: {
      list: () => currentListQuery,
      get: () => currentGetQuery,
    },
  },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const {
  ColumnDefinitionDataList,
  ColumnDefinitionDataItem,
  ColumnDefinitionCardUI,
} = await import("../components/ColumnDefinition.component");
type ColumnDefinitionDataListProps =
  import("../components/ColumnDefinition.component").ColumnDefinitionDataListProps;
type ColumnDefinitionDataItemProps =
  import("../components/ColumnDefinition.component").ColumnDefinitionDataItemProps;

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

describe("ColumnDefinitionDataList", () => {
  beforeEach(() => {
    currentListQuery = {};
  });

  it("should pass query result to children render prop", () => {
    const cd = makeColumnDefinition();
    currentListQuery = {
      data: { columnDefinitions: [cd], total: 1, limit: 10, offset: 0 },
      isSuccess: true,
    } as Partial<ListQuery>;

    const childrenFn = jest.fn((() => (
      <div>list-content</div>
    )) as ColumnDefinitionDataListProps["children"]);
    render(
      <ColumnDefinitionDataList
        query={{ limit: 20, offset: 0, sortBy: "created", sortOrder: "asc" }}
      >
        {childrenFn}
      </ColumnDefinitionDataList>
    );

    expect(childrenFn).toHaveBeenCalled();
    expect(screen.getByText("list-content")).toBeInTheDocument();
  });
});

describe("ColumnDefinitionDataItem", () => {
  beforeEach(() => {
    currentGetQuery = {};
  });

  it("should pass query result to children render prop", () => {
    const cd = makeColumnDefinition();
    currentGetQuery = {
      data: { columnDefinition: cd },
      isSuccess: true,
    } as Partial<GetQuery>;

    const childrenFn = jest.fn((() => (
      <div>item-content</div>
    )) as ColumnDefinitionDataItemProps["children"]);
    render(
      <ColumnDefinitionDataItem id="cd-1">
        {childrenFn}
      </ColumnDefinitionDataItem>
    );

    expect(childrenFn).toHaveBeenCalled();
    expect(screen.getByText("item-content")).toBeInTheDocument();
  });
});

describe("ColumnDefinitionCardUI", () => {
  it("should render label, type chip, and required badge", () => {
    const cd = makeColumnDefinition({
      label: "Email Address",
      type: "string",
      required: true,
    });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.getByText("Email Address")).toBeInTheDocument();
    expect(screen.getByText("string")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("should hide required badge when not required", () => {
    const cd = makeColumnDefinition({ required: false });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
  });

  it("should render key in monospace and description", () => {
    const cd = makeColumnDefinition({
      key: "email_address",
      description: "User email",
    });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.getByText("email_address")).toBeInTheDocument();
    expect(screen.getByText("User email")).toBeInTheDocument();
  });

  it("should render format, default value, and enum values", () => {
    const cd = makeColumnDefinition({
      format: "yyyy-MM-dd",
      defaultValue: "2024-01-01",
      enumValues: ["active", "inactive"],
    });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.getByText("Format: yyyy-MM-dd")).toBeInTheDocument();
    expect(screen.getByText("Default: 2024-01-01")).toBeInTheDocument();
    expect(screen.getByText("Values: active, inactive")).toBeInTheDocument();
  });

  it("should not render metadata row when no format, default, or enum values", () => {
    const cd = makeColumnDefinition({
      format: null,
      defaultValue: null,
      enumValues: null,
    });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.queryByText(/Format:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Default:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Values:/)).not.toBeInTheDocument();
  });

  it("should call onClick with column definition when clicked", () => {
    const cd = makeColumnDefinition();
    const onClick = jest.fn();
    render(<ColumnDefinitionCardUI columnDefinition={cd} onClick={onClick} />);
    fireEvent.click(screen.getByText("First Name"));
    expect(onClick).toHaveBeenCalledWith(cd);
  });

  it("should not throw when clicked without onClick handler", () => {
    const cd = makeColumnDefinition();
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(() => fireEvent.click(screen.getByText("First Name"))).not.toThrow();
  });
});
