import type { Meta, StoryObj } from "@storybook/react";
import { NavbarMenuUI } from "../components/NavbarMenu.component";
import {
  MenuItem,
  ListItemText,
  ListItemIcon,
  Icon,
  IconName,
} from "@mcp-ui/core";

const meta = {
  title: "Components/NavbarMenuUI",
  component: NavbarMenuUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NavbarMenuUI>;

export default meta;
type MenuUIStory = StoryObj<typeof meta>;

export const UIWithCustomChildren: MenuUIStory = {
  args: {
    label: "Jane Smith",
    image: "https://i.pravatar.cc/150?img=5",
    children: (
      <>
        <MenuItem>
          <ListItemIcon>
            <Icon name={IconName.Person} fontSize="small" />
          </ListItemIcon>
          <ListItemText>Profile</ListItemText>
        </MenuItem>
        <MenuItem>
          <ListItemIcon>
            <Icon name={IconName.Settings} fontSize="small" />
          </ListItemIcon>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        <MenuItem>
          <ListItemIcon>
            <Icon name={IconName.Logout} fontSize="small" />
          </ListItemIcon>
          <ListItemText>Logout</ListItemText>
        </MenuItem>
      </>
    ),
  },
};

export const UIWithoutImage: MenuUIStory = {
  args: {
    label: "User Name",
    children: (
      <MenuItem>
        <ListItemText>Menu Item</ListItemText>
      </MenuItem>
    ),
  },
};

export const UIMinimal: MenuUIStory = {
  args: {
    children: (
      <MenuItem>
        <ListItemText>Action</ListItemText>
      </MenuItem>
    ),
  },
};
