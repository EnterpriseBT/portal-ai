import type { Meta, StoryObj } from "@storybook/react";
import { ThemeProvider, useTheme } from "../ThemeProvider";
import { Button } from "../Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";

// Component to display theme information
const ThemeShowcase = () => {
  const { themeName, theme } = useTheme();

  return (
    <Box sx={{ width: "100%", maxWidth: 800 }}>
      <Stack spacing={3}>
        {/* Theme Info */}
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h5" gutterBottom>
            Current Theme
          </Typography>
          <Typography variant="body1" color="text.secondary">
            <strong>Theme Name:</strong> {themeName}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            <strong>Mode:</strong> {theme.palette.mode}
          </Typography>
        </Paper>

        {/* Color Palette */}
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Color Palette
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Box>
              <Typography variant="caption" display="block" gutterBottom>
                Primary
              </Typography>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: "primary.main",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
            </Box>
            <Box>
              <Typography variant="caption" display="block" gutterBottom>
                Secondary
              </Typography>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: "secondary.main",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
            </Box>
            <Box>
              <Typography variant="caption" display="block" gutterBottom>
                Success
              </Typography>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: "success.main",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
            </Box>
            <Box>
              <Typography variant="caption" display="block" gutterBottom>
                Error
              </Typography>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: "error.main",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
            </Box>
            <Box>
              <Typography variant="caption" display="block" gutterBottom>
                Warning
              </Typography>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: "warning.main",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
            </Box>
            <Box>
              <Typography variant="caption" display="block" gutterBottom>
                Info
              </Typography>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  bgcolor: "info.main",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
            </Box>
          </Stack>
        </Paper>

        {/* Typography Examples */}
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Typography
          </Typography>
          <Stack spacing={1}>
            <Typography variant="h1">Heading 1</Typography>
            <Typography variant="h2">Heading 2</Typography>
            <Typography variant="h3">Heading 3</Typography>
            <Typography variant="h4">Heading 4</Typography>
            <Typography variant="h5">Heading 5</Typography>
            <Typography variant="h6">Heading 6</Typography>
            <Typography variant="body1">
              Body 1: Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </Typography>
            <Typography variant="body2">
              Body 2: Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </Typography>
            <Typography variant="caption">
              Caption: Lorem ipsum dolor sit amet.
            </Typography>
            <Typography variant="monospace">
              Monospace: Lorem ipsum dolor sit amet.
            </Typography>
          </Stack>
        </Paper>

        {/* Button Examples */}
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Button Variants
          </Typography>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Button variant="contained" color="primary">
                Primary
              </Button>
              <Button variant="contained" color="secondary">
                Secondary
              </Button>
              <Button variant="contained" color="success">
                Success
              </Button>
              <Button variant="contained" color="error">
                Error
              </Button>
              <Button variant="contained" color="warning">
                Warning
              </Button>
              <Button variant="contained" color="info">
                Info
              </Button>
            </Stack>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Button variant="outlined" color="primary">
                Primary
              </Button>
              <Button variant="outlined" color="secondary">
                Secondary
              </Button>
              <Button variant="outlined" color="success">
                Success
              </Button>
              <Button variant="outlined" color="error">
                Error
              </Button>
              <Button variant="outlined" color="warning">
                Warning
              </Button>
              <Button variant="outlined" color="info">
                Info
              </Button>
            </Stack>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Button variant="text" color="primary">
                Primary
              </Button>
              <Button variant="text" color="secondary">
                Secondary
              </Button>
              <Button variant="text" color="success">
                Success
              </Button>
              <Button variant="text" color="error">
                Error
              </Button>
              <Button variant="text" color="warning">
                Warning
              </Button>
              <Button variant="text" color="info">
                Info
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {/* Background Colors */}
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Background & Text Colors
          </Typography>
          <Stack spacing={2}>
            <Paper sx={{ p: 2, bgcolor: "background.default" }}>
              <Typography>Background Default</Typography>
            </Paper>
            <Paper sx={{ p: 2, bgcolor: "background.paper" }}>
              <Typography>Background Paper</Typography>
            </Paper>
            <Box sx={{ p: 2, bgcolor: "action.hover", borderRadius: 1 }}>
              <Typography>Action Hover</Typography>
            </Box>
            <Box sx={{ p: 2, bgcolor: "action.selected", borderRadius: 1 }}>
              <Typography>Action Selected</Typography>
            </Box>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
};

const meta = {
  title: "Theme/Overview",
  component: ThemeShowcase,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrandLight: Story = {
  parameters: {
    globals: {
      theme: "brand",
    },
  },
  render: () => (
    <ThemeProvider defaultTheme="brand">
      <ThemeShowcase />
    </ThemeProvider>
  ),
};

export const BrandDark: Story = {
  parameters: {
    globals: {
      theme: "brand.dark",
    },
  },
  render: () => (
    <ThemeProvider defaultTheme="brand.dark">
      <ThemeShowcase />
    </ThemeProvider>
  ),
};
