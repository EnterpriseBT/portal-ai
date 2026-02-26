import { IconButton, IconName } from "@mcp-ui/core/ui";
import { useLayout } from "../utils";

export interface SidebarNavToggleProps {
  collapsed: boolean;
  collapsedIcon?: IconName;
  expandedIcon?: IconName;
  onClick: () => void;
}

export const SidebarNavToggleUI = ({
  collapsed,
  collapsedIcon = IconName.KeyboardDoubleArrowRight,
  expandedIcon = IconName.KeyboardDoubleArrowLeft,
  onClick,
}: SidebarNavToggleProps) => {
  return (
    <IconButton
      aria-label="toggle sidebar"
      color="inherit"
      onClick={onClick}
      size="small"
      icon={collapsed ? collapsedIcon : expandedIcon}
    />
  );
};

export const SidebarNavToggle = () => {
  const { isMobile, isCollapsed, toggle } = useLayout();

  return (
    <SidebarNavToggleUI
      collapsed={isCollapsed}
      collapsedIcon={isMobile ? IconName.Menu : undefined}
      expandedIcon={isMobile ? IconName.Close : undefined}
      onClick={() => toggle({ active: false })}
    />
  );
};
