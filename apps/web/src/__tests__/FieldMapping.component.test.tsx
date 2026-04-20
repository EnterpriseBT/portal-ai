import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { FieldMappingListResponsePayload } from "@portalai/core/contracts";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<FieldMappingListResponsePayload, ApiError>;

let currentListQuery: Partial<ListQuery> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    fieldMappings: {
      list: () => currentListQuery,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const { FieldMappingDataList } =
  await import("../components/FieldMapping.component");
type FieldMappingDataListProps =
  import("../components/FieldMapping.component").FieldMappingDataListProps;

describe("FieldMappingDataList", () => {
  beforeEach(() => {
    currentListQuery = {};
  });

  it("should pass query result to children render prop", () => {
    currentListQuery = {
      data: {
        fieldMappings: [
          {
            id: "fm-1",
            organizationId: "org-1",
            connectorEntityId: "ce-1",
            columnDefinitionId: "cd-1",
            sourceField: "email",
            isPrimaryKey: false,
            created: 1735689600000,
            createdBy: "user-1",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      },
      isSuccess: true,
    } as Partial<ListQuery>;

    const childrenFn = jest.fn((() => (
      <div>mapping-content</div>
    )) as FieldMappingDataListProps["children"]);
    render(
      <FieldMappingDataList
        query={{
          columnDefinitionId: "cd-1",
          limit: 20,
          offset: 0,
          sortBy: "created",
          sortOrder: "asc",
        }}
      >
        {childrenFn}
      </FieldMappingDataList>
    );

    expect(childrenFn).toHaveBeenCalled();
    expect(screen.getByText("mapping-content")).toBeInTheDocument();
  });

  it("should pass filtered data when columnDefinitionId is provided", () => {
    currentListQuery = {
      data: {
        fieldMappings: [],
        total: 0,
        limit: 10,
        offset: 0,
      },
      isSuccess: true,
    } as Partial<ListQuery>;

    const childrenFn = jest.fn((() => (
      <div>empty-content</div>
    )) as FieldMappingDataListProps["children"]);
    render(
      <FieldMappingDataList
        query={{
          columnDefinitionId: "cd-99",
          limit: 10,
          offset: 0,
          sortBy: "created",
          sortOrder: "asc",
        }}
      >
        {childrenFn}
      </FieldMappingDataList>
    );

    expect(childrenFn).toHaveBeenCalled();
    expect(screen.getByText("empty-content")).toBeInTheDocument();
  });
});
