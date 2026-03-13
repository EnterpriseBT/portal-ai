import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { Box } from "@mcp-ui/core/ui";
import {
  PaginationToolbar,
  usePagination,
  type FilterConfig,
  type SortFieldConfig,
} from "../components/PaginationToolbar.component";
import React from "react";

const sampleFilterConfigs: FilterConfig[] = [
  {
    type: "select",
    field: "category",
    label: "Category",
    options: [
      { label: "CRM", value: "crm" },
      { label: "Marketing", value: "marketing" },
      { label: "Analytics", value: "analytics" },
      { label: "Communication", value: "communication" },
    ],
  },
  {
    type: "select",
    field: "authType",
    label: "Auth Type",
    options: [
      { label: "OAuth2", value: "oauth2" },
      { label: "API Key", value: "api_key" },
      { label: "Basic Auth", value: "basic" },
    ],
  },
  {
    type: "boolean",
    field: "isActive",
    label: "Active",
  },
];

const allFilterTypes: FilterConfig[] = [
  {
    type: "select",
    field: "category",
    label: "Category",
    options: [
      { label: "CRM", value: "crm" },
      { label: "Marketing", value: "marketing" },
      { label: "Analytics", value: "analytics" },
    ],
  },
  {
    type: "boolean",
    field: "isActive",
    label: "Active",
  },
  {
    type: "number",
    field: "minConnections",
    label: "Min Connections",
    min: 0,
    max: 1000,
    placeholder: "e.g. 10",
  },
  {
    type: "text",
    field: "tag",
    label: "Tag",
    placeholder: "Enter a tag name",
  },
];

const sampleSortFields: SortFieldConfig[] = [
  { field: "created", label: "Date Created" },
  { field: "display", label: "Name" },
  { field: "category", label: "Category" },
];

const defaultPaginationArgs = {
  offset: 0,
  limit: 20,
  limitOptions: [10, 20, 50, 100],
  total: 95,
  currentPage: 1,
  totalPages: 5,
};

const meta = {
  title: "Components/PaginationToolbar",
  component: PaginationToolbar,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ p: 2 }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    onSearchChange: fn(),
    onFilterValueChange: fn(),
    onSortByChange: fn(),
    onSortOrderChange: fn(),
    onLimitChange: fn(),
    onFirst: fn(),
    onPrev: fn(),
    onNext: fn(),
    onLast: fn(),
    ...defaultPaginationArgs,
  },
} satisfies Meta<typeof PaginationToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    search: "",
    filterConfigs: sampleFilterConfigs,
    filters: {},
    activeFilterCount: 0,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const WithSearchValue: Story = {
  args: {
    search: "salesforce",
    filterConfigs: sampleFilterConfigs,
    filters: {},
    activeFilterCount: 0,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const WithActiveFilters: Story = {
  args: {
    search: "",
    filterConfigs: sampleFilterConfigs,
    filters: {
      category: ["crm"],
      authType: ["oauth2"],
    },
    activeFilterCount: 2,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const SortDescending: Story = {
  args: {
    search: "",
    filterConfigs: sampleFilterConfigs,
    filters: {},
    activeFilterCount: 0,
    sortFields: sampleSortFields,
    sortBy: "display",
    sortOrder: "desc",
  },
};

export const SearchOnly: Story = {
  args: {
    search: "",
    filterConfigs: [],
    filters: {},
    activeFilterCount: 0,
    sortFields: [],
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const AllFilterTypes: Story = {
  args: {
    search: "",
    filterConfigs: allFilterTypes,
    filters: {
      category: ["crm"],
      isActive: ["true"],
      minConnections: ["50"],
      tag: ["enterprise"],
    },
    activeFilterCount: 4,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const BooleanFilters: Story = {
  args: {
    search: "",
    filterConfigs: [
      { type: "boolean", field: "isActive", label: "Active" },
      { type: "boolean", field: "isVerified", label: "Verified" },
    ],
    filters: { isActive: ["true"] },
    activeFilterCount: 1,
    sortFields: [],
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const NumberAndTextFilters: Story = {
  args: {
    search: "",
    filterConfigs: [
      {
        type: "number",
        field: "minConnections",
        label: "Min Connections",
        min: 0,
        max: 1000,
      },
      {
        type: "text",
        field: "tag",
        label: "Tag",
        placeholder: "Enter a tag name",
      },
    ],
    filters: {},
    activeFilterCount: 0,
    sortFields: [],
    sortBy: "created",
    sortOrder: "asc",
  },
};

export const MidPage: Story = {
  args: {
    search: "",
    filterConfigs: sampleFilterConfigs,
    filters: {},
    activeFilterCount: 0,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
    offset: 40,
    currentPage: 3,
    totalPages: 5,
    total: 95,
  },
};

export const LastPage: Story = {
  args: {
    search: "",
    filterConfigs: sampleFilterConfigs,
    filters: {},
    activeFilterCount: 0,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
    offset: 80,
    currentPage: 5,
    totalPages: 5,
    total: 95,
  },
};

/** Interactive story that uses the `usePagination` hook to wire up state. */
export const Interactive: Story = {
  args: {
    search: "",
    filterConfigs: allFilterTypes,
    filters: {},
    activeFilterCount: 0,
    sortFields: sampleSortFields,
    sortBy: "created",
    sortOrder: "asc",
  },
  render: () => {
    const pagination = usePagination({
      filters: allFilterTypes,
      sortFields: sampleSortFields,
    });

    // Simulate a total count from the server
    React.useEffect(() => {
      pagination.setTotal(95);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <PaginationToolbar {...pagination.toolbarProps} />
        <Box
          component="pre"
          sx={{
            p: 2,
            bgcolor: "grey.100",
            borderRadius: 1,
            fontSize: 12,
            overflow: "auto",
          }}
        >
          {JSON.stringify(pagination.queryParams, null, 2)}
        </Box>
      </Box>
    );
  },
};
