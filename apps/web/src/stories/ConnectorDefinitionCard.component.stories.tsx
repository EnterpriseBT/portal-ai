import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { ConnectorDefinition } from "@portalai/core/models";
import {
  ConnectorDefinitionCardUI,
  ConnectorDefinitionCardUIProps,
} from "../components/ConnectorDefinition.component";

const baseConnector: ConnectorDefinition = {
  id: "cd-001",
  created: Date.now(),
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  slug: "salesforce",
  display: "Salesforce",
  category: "CRM",
  authType: "OAuth2",
  configSchema: null,
  capabilityFlags: { sync: true, query: true, write: true },
  isActive: true,
  version: "1.2.0",
  iconUrl: null,
};

const meta = {
  title: "Components/ConnectorDefinitionCardUI",
  component: ConnectorDefinitionCardUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    onConnect: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectorDefinitionCardUI>;

export default meta;
type Story = StoryObj<ConnectorDefinitionCardUIProps>;

export const Default: Story = {
  args: {
    connectorDefinition: baseConnector,
  },
};

export const WithIcon: Story = {
  args: {
    connectorDefinition: {
      ...baseConnector,
      iconUrl:
        "https://cdn.jsdelivr.net/gh/gilbarbara/logos@main/logos/salesforce.svg",
    },
  },
};

export const Inactive: Story = {
  args: {
    connectorDefinition: {
      ...baseConnector,
      display: "Legacy FTP",
      slug: "legacy-ftp",
      category: "File Storage",
      authType: "Basic",
      isActive: false,
      version: "0.9.1",
      capabilityFlags: { sync: true },
    },
  },
};

export const ReadOnly: Story = {
  args: {
    connectorDefinition: {
      ...baseConnector,
      display: "Google BigQuery",
      slug: "bigquery",
      category: "Data Warehouse",
      authType: "OAuth2",
      capabilityFlags: { query: true },
      version: "2.0.0",
    },
  },
};

export const NoCapabilities: Story = {
  args: {
    connectorDefinition: {
      ...baseConnector,
      display: "CSV Upload",
      slug: "csv-upload",
      category: "File",
      authType: "None",
      capabilityFlags: {},
      version: "1.0.0",
    },
  },
};

export const AllFields: Story = {
  args: {
    connectorDefinition: {
      ...baseConnector,
      display: "PostgreSQL",
      slug: "postgresql",
      category: "Database",
      authType: "Connection String",
      capabilityFlags: { sync: true, query: true, write: true },
      version: "3.1.4",
      iconUrl:
        "https://cdn.jsdelivr.net/gh/gilbarbara/logos@main/logos/postgresql.svg",
    },
  },
};
