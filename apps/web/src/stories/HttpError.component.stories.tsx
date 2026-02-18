import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { HttpError } from "../components/HttpError.component";

// Minimal router for storybook so useRouter is available
const createStoryRouter = (story: () => React.ReactNode) => {
  const rootRoute = createRootRoute({ component: () => story() });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  });
};

const meta = {
  title: "Components/HttpError",
  component: HttpError,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    statusCode: {
      control: "number",
      description: "HTTP status code",
    },
    title: {
      control: "text",
      description: "Short title displayed as the heading",
    },
    description: {
      control: "text",
      description: "Longer description below the heading",
    },
    showBackButton: {
      control: "boolean",
      description: "Show a Go Back button",
    },
    showHomeButton: {
      control: "boolean",
      description: "Show a Go Home button",
    },
  },
  decorators: [
    (Story) => {
      const router = createStoryRouter(() => <Story />);
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof HttpError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotFound: Story = {
  args: {
    statusCode: 404,
    title: "Page Not Found",
    description: "The page you're looking for doesn't exist or has been moved.",
  },
};

export const Unauthorized: Story = {
  args: {
    statusCode: 401,
    title: "Unauthorized",
    description: "You need to sign in to access this page.",
  },
};

export const Forbidden: Story = {
  args: {
    statusCode: 403,
    title: "Forbidden",
    description: "You don't have permission to access this resource.",
  },
};

export const ServerError: Story = {
  args: {
    statusCode: 500,
    title: "Internal Server Error",
    description: "Something went wrong on our end. Please try again later.",
  },
};

export const NoDescription: Story = {
  args: {
    statusCode: 404,
    title: "Page Not Found",
  },
};

export const NoButtons: Story = {
  args: {
    statusCode: 500,
    title: "Internal Server Error",
    description: "Something went wrong on our end. Please try again later.",
    showBackButton: false,
    showHomeButton: false,
  },
};

export const BackButtonOnly: Story = {
  args: {
    statusCode: 403,
    title: "Forbidden",
    description: "You don't have permission to access this resource.",
    showHomeButton: false,
  },
};
