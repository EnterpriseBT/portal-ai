import { Box, Typography, Tabs, Tab, TabPanel, useTabs } from "@mcp-ui/core/ui";

export const SettingsView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();

  return (
    <Box>
      <Typography variant="h1" gutterBottom>
        Settings
      </Typography>

      <Tabs {...tabsProps}>
        <Tab label="Profile" {...getTabProps(0)} />
        <Tab label="Organization" {...getTabProps(1)} />
      </Tabs>
      <TabPanel {...getTabPanelProps(0)}>
        <Typography variant="h2">Profile</Typography>
      </TabPanel>
      <TabPanel {...getTabPanelProps(1)}>
        <Typography variant="h2">Organization</Typography>
      </TabPanel>
    </Box>
  );
};
