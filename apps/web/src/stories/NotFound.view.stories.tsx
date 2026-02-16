import type { Meta, StoryObj } from "@storybook/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { NotFoundView } from "../views/NotFound.view";

const createStoryRouter = (story: () => React.ReactNode) => {
  const rootRoute = createRootRoute({ component: () => story() });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  });
};

const meta = {
  title: "Views/NotFoundView",
  component: NotFoundView,
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
} satisfies Meta<typeof NotFoundView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomDescription: Story = {
  args: {
    description: "We couldn't find what you were looking for.",
  },
};
