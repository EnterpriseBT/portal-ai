import { IconButton, IconName } from "@portalai/core/ui";
import { useLayout } from "../utils";

export interface SidebarNavToggleProps {
  collapsed: boolean;
  collapsedIcon?: IconName;
  expandedIcon?: IconName;
  onClick: () => void;
}

export const SidebarNavToggleUI = ({
  collapsed,
  collapsedIcon = IconName.KeyboardArrowRight,
  expandedIcon = IconName.KeyboardArrowLeft,
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
      onClick={() => toggle()}
    />
  );
};
