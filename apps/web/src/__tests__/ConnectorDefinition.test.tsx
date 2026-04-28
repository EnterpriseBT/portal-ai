import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  ConnectorDefinitionGetResponsePayload,
  ConnectorDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import type { ConnectorDefinition } from "@portalai/core/models";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<
  ConnectorDefinitionListResponsePayload,
  ApiError
>;
type GetQuery = UseQueryResult<ConnectorDefinitionGetResponsePayload, ApiError>;

let currentListQuery: Partial<ListQuery> = {};
let currentGetQuery: Partial<GetQuery> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorDefinitions: {
      list: () => currentListQuery,
      get: () => currentGetQuery,
    },
  },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const {
  ConnectorDefinitionDataList,
  ConnectorDefinitionDataItem,
  ConnectorDefinitionItem,
  ConnectorDefinitionCardUI,
} = await import("../components/ConnectorDefinition.component");
type ConnectorDefinitionDataListProps =
  import("../components/ConnectorDefinition.component").ConnectorDefinitionDataListProps;
type ConnectorDefinitionDataItemProps =
  import("../components/ConnectorDefinition.component").ConnectorDefinitionDataItemProps;

const makeConnectorDefinition = (
  overrides: Partial<ConnectorDefinition> = {}
): ConnectorDefinition => ({
  id: "cd-1",
  slug: "postgres",
  display: "PostgreSQL",
  category: "Database",
  authType: "password",
  configSchema: null,
  capabilityFlags: { sync: true, read: true, write: false, push: false },
  isActive: true,
  version: "1.0.0",
  iconUrl: "https://example.com/pg.png",
  created: 1735689600000,
  createdBy: "user-1",
  updated: 1735689600000,
  updatedBy: "user-1",
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("ConnectorDefinitionDataList", () => {
  beforeEach(() => {
    currentListQuery = {};
  });

  it("should pass query result to children render prop", () => {
    const cd = makeConnectorDefinition();
    currentListQuery = {
      data: { connectorDefinitions: [cd], total: 1, limit: 10, offset: 0 },
      isSuccess: true,
    } as Partial<ListQuery>;

    const childrenFn = jest.fn((() => (
      <div>list-content</div>
    )) as ConnectorDefinitionDataListProps["children"]);
    render(
      <ConnectorDefinitionDataList
        query={{ limit: 20, offset: 0, sortBy: "created", sortOrder: "asc" }}
      >
        {childrenFn}
      </ConnectorDefinitionDataList>
    );

    expect(childrenFn).toHaveBeenCalled();
    expect(screen.getByText("list-content")).toBeInTheDocument();
  });
});

describe("ConnectorDefinitionDataItem", () => {
  beforeEach(() => {
    currentGetQuery = {};
  });

  it("should pass query result to children render prop", () => {
    const cd = makeConnectorDefinition();
    currentGetQuery = {
      data: { connectorDefinition: cd },
      isSuccess: true,
    } as Partial<GetQuery>;

    const childrenFn = jest.fn((() => (
      <div>item-content</div>
    )) as ConnectorDefinitionDataItemProps["children"]);
    render(
      <ConnectorDefinitionDataItem id="cd-1">
        {childrenFn}
      </ConnectorDefinitionDataItem>
    );

    expect(childrenFn).toHaveBeenCalled();
    expect(screen.getByText("item-content")).toBeInTheDocument();
  });
});

describe("ConnectorDefinitionItem", () => {
  it("should pass connector definition to children render prop", () => {
    const cd = makeConnectorDefinition({ display: "MySQL" });
    const childrenFn = jest.fn((data: ConnectorDefinition) => (
      <div>{data.display}</div>
    ));

    render(
      <ConnectorDefinitionItem connectorDefinition={cd}>
        {childrenFn}
      </ConnectorDefinitionItem>
    );

    expect(childrenFn).toHaveBeenCalledWith(cd);
    expect(screen.getByText("MySQL")).toBeInTheDocument();
  });
});

describe("ConnectorDefinitionCardUI", () => {
  it("should render display name", () => {
    const cd = makeConnectorDefinition({ display: "PostgreSQL" });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
  });

  it("should render category, authType, and version", () => {
    const cd = makeConnectorDefinition({
      category: "Database",
      authType: "password",
      version: "2.0.0",
    });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText(/Database/)).toBeInTheDocument();
    expect(screen.getByText(/password/)).toBeInTheDocument();
    expect(screen.getByText(/v2\.0\.0/)).toBeInTheDocument();
  });

  it("should show Active chip when isActive is true", () => {
    const cd = makeConnectorDefinition({ isActive: true });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("should show Inactive chip when isActive is false", () => {
    const cd = makeConnectorDefinition({ isActive: false });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("should render capability chips for enabled capabilities", () => {
    const cd = makeConnectorDefinition({
      capabilityFlags: { sync: true, read: true, write: true, push: true },
    });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText("sync")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
    expect(screen.getByText("push")).toBeInTheDocument();
  });

  it("should not render capability chips for disabled capabilities", () => {
    const cd = makeConnectorDefinition({
      capabilityFlags: { sync: false, read: false, write: false, push: false },
    });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.queryByText("sync")).not.toBeInTheDocument();
    expect(screen.queryByText("read")).not.toBeInTheDocument();
    expect(screen.queryByText("write")).not.toBeInTheDocument();
    expect(screen.queryByText("push")).not.toBeInTheDocument();
  });

  it("should render only enabled capability chips", () => {
    const cd = makeConnectorDefinition({
      capabilityFlags: { sync: true, read: false, write: true, push: false },
    });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText("sync")).toBeInTheDocument();
    expect(screen.queryByText("read")).not.toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
    expect(screen.queryByText("push")).not.toBeInTheDocument();
  });

  it("should render avatar with icon when iconUrl is provided", () => {
    const cd = makeConnectorDefinition({
      iconUrl: "https://example.com/icon.png",
      display: "PostgreSQL",
    });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    const avatar = screen.getByAltText("PostgreSQL");
    expect(avatar).toHaveAttribute("src", "https://example.com/icon.png");
  });

  it("should render avatar with first letter when iconUrl is null", () => {
    const cd = makeConnectorDefinition({
      iconUrl: null,
      display: "PostgreSQL",
    });
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("should render Connect button", () => {
    const cd = makeConnectorDefinition();
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("should call onConnect with connector definition when Connect is clicked", () => {
    const cd = makeConnectorDefinition();
    const onConnect = jest.fn();
    render(
      <ConnectorDefinitionCardUI
        connectorDefinition={cd}
        onConnect={onConnect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith(cd);
  });

  it("should not throw when Connect is clicked without onConnect handler", () => {
    const cd = makeConnectorDefinition();
    render(<ConnectorDefinitionCardUI connectorDefinition={cd} />);
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Connect" }))
    ).not.toThrow();
  });
});
