import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ForbiddenView } from "../views/Forbidden.view";

const createStoryRouter = (story: () => React.ReactNode) => {
  const rootRoute = createRootRoute({ component: () => story() });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  });
};

const meta = {
  title: "Views/ForbiddenView",
  component: ForbiddenView,
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
} satisfies Meta<typeof ForbiddenView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomDescription: Story = {
  args: {
    description: "Contact an administrator for access.",
  },
};
