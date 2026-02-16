import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ServerErrorView } from "../views/ServerError.view";

const createStoryRouter = (story: () => React.ReactNode) => {
  const rootRoute = createRootRoute({ component: () => story() });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  });
};

const meta = {
  title: "Views/ServerErrorView",
  component: ServerErrorView,
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
} satisfies Meta<typeof ServerErrorView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomDescription: Story = {
  args: {
    description:
      "Our team has been notified. Please try again in a few minutes.",
  },
};
