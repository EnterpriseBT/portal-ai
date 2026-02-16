import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { UnauthorizedView } from "../views/Unauthorized.view";

const createStoryRouter = (story: () => React.ReactNode) => {
  const rootRoute = createRootRoute({ component: () => story() });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  });
};

const meta = {
  title: "Views/UnauthorizedView",
  component: UnauthorizedView,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => {
      const router = createStoryRouter(() => <Story />);
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof UnauthorizedView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomDescription: Story = {
  args: {
    description: "Your session has expired. Please sign in again.",
  },
};
