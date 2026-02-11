import type { Meta, StoryObj } from "@storybook/react";
import { AuthorizedUI } from "../components/Authorized.component";
import { Box } from "@mcp-ui/core";

const meta = {
  title: "Components/AuthorizedUI",
  component: AuthorizedUI,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    loading: {
      control: "boolean",
      description: "Whether the component is in a loading state",
    },
    error: {
      control: "object",
      description: "Error object to display error view",
    },
    children: {
      control: "text",
      description: "Content to render when authenticated",
    },
  },
} satisfies Meta<typeof AuthorizedUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    loading: true,
    error: undefined,
    children: <div>Protected Content</div>,
  },
};

export const WithError: Story = {
  args: {
    loading: false,
    error: new Error("Authentication failed. Please try logging in again."),
    children: <div>Protected Content</div>,
  },
};

export const Authenticated: Story = {
  args: {
    loading: false,
    error: undefined,
    children: (
      <Box sx={{ p: 4 }}>
        <h1>Protected Dashboard</h1>
        <p>This content is only visible to authenticated users.</p>
      </Box>
    ),
  },
};

export const AuthenticatedWithCustomContent: Story = {
  args: {
    loading: false,
    error: undefined,
    children: (
      <Box sx={{ p: 4, bgcolor: "background.paper", minHeight: "100vh" }}>
        <h1>Welcome Back!</h1>
        <p>You have successfully authenticated.</p>
        <ul>
          <li>Access your dashboard</li>
          <li>View your profile</li>
          <li>Manage settings</li>
        </ul>
      </Box>
    ),
  },
};
