import type { Meta, StoryObj } from "@storybook/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { BadRequestView } from "../views/BadRequest.view";
import React from "react";

const createStoryRouter = (story: () => React.ReactNode) => {
  const rootRoute = createRootRoute({ component: () => story() });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  });
};

const meta = {
  title: "Views/BadRequestView",
  component: BadRequestView,
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
} satisfies Meta<typeof BadRequestView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomDescription: Story = {
  args: {
    description: "The request parameters were invalid.",
  },
};
