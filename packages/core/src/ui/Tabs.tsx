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

export interface UseTabsOptions {
  /**
   * When provided, the hook is **controlled**: this value is rendered and the
   * hook's own state is not read. Omit for the existing uncontrolled
   * behavior. Added for Help (#365), whose tab is addressable by URL and so
   * cannot be owned by the component that renders it.
   */
  value?: number;
  /** Called on tab change — and on imperative `setValue` — in controlled mode. */
  onChange?: (value: number) => void;
}

export function useTabs(initialValue = 0, options?: UseTabsOptions) {
  const [internalValue, setInternalValue] = React.useState(initialValue);

  // Keyed on the presence of `value`, not on a separate flag, so a caller
  // cannot claim to be controlled without supplying one. The state above is
  // declared unconditionally either way — no conditional hook.
  const isControlled = options?.value !== undefined;
  const value = isControlled ? (options.value as number) : internalValue;
  const onChange = options?.onChange;

  const setValue = React.useCallback(
    (newValue: number) => {
      if (isControlled) {
        onChange?.(newValue);
        return;
      }
      setInternalValue(newValue);
    },
    [isControlled, onChange]
  );

  const handleChange = React.useCallback(
    (_event: React.SyntheticEvent, newValue: number) => {
      setValue(newValue);
    },
    [setValue]
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
    const active = value === index;
    return (
      <Box
        ref={ref}
        role="tabpanel"
        hidden={!active}
        id={`tabpanel-${index}`}
        aria-labelledby={`tab-${index}`}
        {...props}
      >
        <Box padding={2}>{children}</Box>
      </Box>
    );
  }
);
