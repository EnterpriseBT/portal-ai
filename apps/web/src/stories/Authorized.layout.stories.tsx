import type { Meta, StoryObj } from "@storybook/react";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { Box, Typography } from "@mcp-ui/core/ui";
import { Auth0Provider } from "@auth0/auth0-react";

const meta = {
  title: "Layouts/AuthorizedLayout",
  component: AuthorizedLayout,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Auth0Provider
        domain="dev-example.auth0.com"
        clientId="mock-client-id"
        authorizationParams={{
          redirect_uri: window.location.origin,
        }}
      >
        <Story />
      </Auth0Provider>
    ),
  ],
} satisfies Meta<typeof AuthorizedLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <Box>
        <Typography variant="h5" gutterBottom>
          Dashboard
        </Typography>
        <Typography variant="body1">
          This is the main content area of the authorized layout. Your
          application content will be displayed here.
        </Typography>
      </Box>
    ),
  },
};

export const WithMultipleElements: Story = {
  args: {
    children: (
      <Box display="flex" flexDirection="column" gap={3}>
        <Typography variant="h4">Welcome to MCP UI</Typography>
        <Box
          sx={{
            p: 3,
            bgcolor: "background.paper",
            borderRadius: 1,
          }}
        >
          <Typography variant="h6" gutterBottom>
            Card 1
          </Typography>
          <Typography variant="body2">
            This layout provides a consistent header with navigation and a
            scrollable content area.
          </Typography>
        </Box>
        <Box
          sx={{
            p: 3,
            bgcolor: "background.paper",
            borderRadius: 1,
          }}
        >
          <Typography variant="h6" gutterBottom>
            Card 2
          </Typography>
          <Typography variant="body2">
            The content area takes up the remaining viewport height and scrolls
            when needed.
          </Typography>
        </Box>
      </Box>
    ),
  },
};

export const WithLongContent: Story = {
  args: {
    children: (
      <Box display="flex" flexDirection="column" gap={2}>
        <Typography variant="h4">Scrollable Content</Typography>
        {Array.from({ length: 20 }, (_, i) => (
          <Box
            key={i}
            sx={{
              p: 2,
              bgcolor: "background.paper",
              borderRadius: 1,
            }}
          >
            <Typography variant="body1">Content Block {i + 1}</Typography>
            <Typography variant="body2" color="text.secondary">
              This demonstrates how the layout handles scrolling when content
              exceeds the viewport height.
            </Typography>
          </Box>
        ))}
      </Box>
    ),
  },
};
