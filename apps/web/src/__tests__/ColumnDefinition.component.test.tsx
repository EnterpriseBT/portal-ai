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
  description: null,
  validationPattern: null,
  validationMessage: null,
  canonicalFormat: null,
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
  it("should render label and type chip", () => {
    const cd = makeColumnDefinition({
      label: "Email Address",
      type: "string",
    });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.getByText("Email Address")).toBeInTheDocument();
    expect(screen.getByText("string")).toBeInTheDocument();
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

  it("should not render validationPattern or canonicalFormat on the card", () => {
    const cd = makeColumnDefinition({
      validationPattern: "^\\d{4}-\\d{2}-\\d{2}$",
      canonicalFormat: "yyyy-MM-dd",
    });
    render(<ColumnDefinitionCardUI columnDefinition={cd} />);
    expect(screen.queryByText("^\\d{4}-\\d{2}-\\d{2}$")).not.toBeInTheDocument();
    expect(screen.queryByText("yyyy-MM-dd")).not.toBeInTheDocument();
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
