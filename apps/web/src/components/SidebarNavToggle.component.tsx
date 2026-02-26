import { IconButton, IconName } from "@mcp-ui/core/ui";
import { useLayout } from "../utils";

export interface SidebarNavToggleProps {
  collapsed: boolean;
  onClick: () => void;
}

export const SidebarNavToggleUI = ({
  collapsed,
  onClick,
}: SidebarNavToggleProps) => {
  return (
    <IconButton
      color="inherit"
      onClick={onClick}
      icon={
        collapsed
          ? IconName.KeyboardDoubleArrowRight
          : IconName.KeyboardDoubleArrowLeft
      }
    />
  );
};

export const SidebarNavToggle = () => {
  const { isCollapsed, toggle } = useLayout();

  return (
    <SidebarNavToggleUI
      collapsed={isCollapsed}
      onClick={() => toggle({ active: true })}
    />
  );
};
