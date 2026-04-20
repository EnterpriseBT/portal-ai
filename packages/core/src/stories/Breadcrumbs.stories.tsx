import type { Meta, StoryObj } from "@storybook/react";
import { Breadcrumbs } from "../ui/Breadcrumbs";
import { IconName } from "../ui/Icon";

const meta = {
  title: "Components/Breadcrumbs",
  component: Breadcrumbs,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    separator: {
      control: "text",
      description: "Separator between breadcrumb items",
    },
    maxItems: {
      control: "number",
      description: "Maximum items before collapsing",
    },
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [
      { label: "Home", href: "/" },
      { label: "Products", href: "/products" },
      { label: "Widget" },
    ],
  },
};

export const WithIcons: Story = {
  args: {
    items: [
      { label: "Home", href: "/", icon: IconName.Home },
      { label: "Settings", href: "/settings", icon: IconName.Settings },
      { label: "Profile" },
    ],
  },
};

export const TwoItems: Story = {
  args: {
    items: [{ label: "Dashboard", href: "/dashboard" }, { label: "Details" }],
  },
};

export const SingleItem: Story = {
  args: {
    items: [{ label: "Home" }],
  },
};

export const Collapsed: Story = {
  args: {
    items: [
      { label: "Home", href: "/" },
      { label: "Category", href: "/category" },
      { label: "Subcategory", href: "/category/sub" },
      { label: "Products", href: "/category/sub/products" },
      { label: "Widget" },
    ],
    maxItems: 3,
  },
};

export const CustomSeparator: Story = {
  args: {
    items: [
      { label: "Home", href: "/" },
      { label: "Library", href: "/library" },
      { label: "Data" },
    ],
    separator: "›",
  },
};
