import React from "react";
import MuiTabs from "@mui/material/Tabs";
import MuiTab from "@mui/material/Tab";
import type { TabsProps as MuiTabsProps } from "@mui/material/Tabs";
import type { TabProps as MuiTabProps } from "@mui/material/Tab";
import Box from "@mui/material/Box";

export type TabsProps = MuiTabsProps;
export type TabProps = MuiTabProps;

export interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  className?: string;
  [key: `data-${string}`]: string;
}

export function useTabs(initialValue = 0) {
  const [value, setValue] = React.useState(initialValue);

  const handleChange = React.useCallback(
    (_event: React.SyntheticEvent, newValue: number) => {
      setValue(newValue);
    },
    []
  );

  const tabsProps = {
    value,
    onChange: handleChange,
  };

  const getTabProps = (index: number) => ({
    id: `tab-${index}`,
    "aria-controls": `tabpanel-${index}`,
  });

  const getTabPanelProps = (index: number) => ({
    value,
    index,
  });

  return {
    value,
    setValue,
    handleChange,
    tabsProps,
    getTabProps,
    getTabPanelProps,
  };
}

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ children, ...props }, ref) => {
    return (
      <MuiTabs ref={ref} {...props}>
        {children}
      </MuiTabs>
    );
  }
);

export const Tab = React.forwardRef<HTMLDivElement, TabProps>(
  ({ ...props }, ref) => {
    return <MuiTab ref={ref} {...props} />;
  }
);

export const TabPanel = React.forwardRef<HTMLDivElement, TabPanelProps>(
  ({ children, value, index, ...props }, ref) => {
    return (
      <Box
        ref={ref}
        role="tabpanel"
        hidden={value !== index}
        id={`tabpanel-${index}`}
        aria-labelledby={`tab-${index}`}
        {...props}
      >
        {value === index && <Box padding={2}>{children}</Box>}
      </Box>
    );
  }
);
