# @mcp-ui/core

Core React component library for MCP UI with Material-UI integration.

## Installation

```bash
npm install @mcp-ui/core
```

## Quick Start

```tsx
import { ThemeProvider, Button } from '@mcp-ui/core';
import '@mcp-ui/core/styles';

function App() {
  return (
    <ThemeProvider>
      <Button variant="contained" color="primary">
        Click me
      </Button>
    </ThemeProvider>
  );
}
```

## Styles

Import the pre-compiled CSS to get custom fonts and global styles:

```tsx
import '@mcp-ui/core/styles';
```

## Components

- **Button**: Material-UI Button wrapper with consistent styling
- **IconButton**: Button component with icon support
- **Typography**: Material-UI Typography with custom font variants
- **Icon**: Icon component with Material Icons integration
- **ThemeProvider**: Theme provider with light/dark mode support

## Theme

The library includes pre-configured Material-UI themes:
- Brand Light theme (default)
- Brand Dark theme

Custom fonts:
- **Noto Sans**: Primary body font
- **Playfair Display**: Heading font
- **Cutive Mono**: Monospace font
