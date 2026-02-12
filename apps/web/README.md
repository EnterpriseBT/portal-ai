# MCP UI Web

React web application for the MCP UI project with Auth0 authentication, Material UI, and TanStack Router.

## Features

- ✅ React 18 with TypeScript
- ✅ Auth0 authentication with JWT tokens
- ✅ TanStack Router for file-based routing
- ✅ TanStack Query for data fetching and caching
- ✅ Material UI (MUI) components
- ✅ Theme switching (Brand, Light, Dark themes)
- ✅ Protected and public routes
- ✅ Storybook for component development
- ✅ Jest + React Testing Library for testing
- ✅ ESLint + Prettier for code quality

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or pnpm
- Running API server (see `/apps/api/README.md`)

### Environment Variables

Create a `.env` file in the web app directory (`apps/web/.env`) with the following variables:

```env
VITE_AUTH0_CLIENT_ID=your-auth0-client-id
VITE_AUTH0_DOMAIN=your-domain.auth0.com
VITE_AUTH0_AUDIENCE=https://api.mcp-ui.dev
```

> **Note:** All environment variables must be prefixed with `VITE_` to be accessible in the Vite application.

### Installation & Development

From the monorepo root:

```bash
# Install dependencies
npm install

# Build packages (required on first run)
npm run build

# Start development server
npm run dev --workspace=@mcp-ui/web
```

The web app will start on `http://localhost:3000`.

Alternatively, from the `apps/web` directory:

```bash
npm run dev
```

### Building for Production

```bash
# From monorepo root
npm run build --workspace=@mcp-ui/web

# Or from apps/web
npm run build
```

The production build will be output to `dist/`.

## Available Scripts

- `npm run dev` - Start Vite development server with HMR
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run type-check` - Run TypeScript type checking
- `npm run test` - Run Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report
- `npm run storybook` - Start Storybook on port 6007
- `npm run build-storybook` - Build static Storybook site

## Project Structure

```
src/
├── api/                # API client functions
├── components/         # React components (*.component.tsx)
├── layouts/            # Layout components (*.layout.tsx)
├── routes/             # TanStack Router routes
├── stories/            # Storybook stories (*.stories.tsx)
├── utils/              # Utility functions and hooks
├── views/              # Page view components (*.view.tsx)
├── __tests__/          # Test files and setup
├── App.tsx             # Root app component with providers
├── client.ts           # TanStack Query client configuration
├── main.tsx            # Application entry point
├── router.ts           # Router configuration
└── routeTree.gen.ts    # Auto-generated route tree
```

## Project Conventions

### File Naming

We use descriptive suffixes to indicate the type and purpose of each file:

- **Components**: `*.component.tsx` - Reusable UI components
  - Example: `Header.component.tsx`, `NavbarMenu.component.tsx`

- **Views**: `*.view.tsx` - Page-level components
  - Example: `Dashboard.view.tsx`, `Login.view.tsx`

- **Layouts**: `*.layout.tsx` - Layout wrapper components
  - Example: `Authorized.layout.tsx`, `Public.layout.tsx`

- **Stories**: `*.stories.tsx` - Storybook stories
  - Example: `Header.stories.tsx`

- **Tests**: `*.test.tsx` or `*.test.ts` - Jest tests
  - Example: `Header.component.test.tsx`

- **Utils**: `*.util.ts` - Utility functions and custom hooks
  - Example: `api.util.ts`, `storage.util.ts`

### Naming Conventions

- **Components, Views, Layouts**: PascalCase with descriptive names
  - `LoginForm`, `Dashboard`, `AuthorizedLayout`

- **Functions & Hooks**: camelCase
  - `useAuthFetch`, `useStorage`, `formatDate`

- **Constants**: UPPER_SNAKE_CASE
  - `API_BASE_URL`, `DEFAULT_THEME`

- **Interfaces & Types**: PascalCase
  - `UserProfile`, `ApiResponse`, `ThemeName`

### Component Structure

Components should follow this general structure:

```typescript
import React from "react";
import { useCustomHook } from "../utils/hooks.util";

// Props interface
interface MyComponentProps {
  title: string;
  onAction?: () => void;
}

// Component
export const MyComponent: React.FC<MyComponentProps> = ({ title, onAction }) => {
  // Hooks
  const customData = useCustomHook();

  // Event handlers
  const handleClick = () => {
    onAction?.();
  };

  // Render
  return (
    <Box>
      <Typography>{title}</Typography>
      {/* Component JSX */}
    </Box>
  );
};
```

### Import Organization

Organize imports in this order:

1. React and React-related libraries
2. Third-party libraries
3. Monorepo packages (`@mcp-ui/*`)
4. Local components and utilities
5. Types and interfaces
6. Styles and assets

```typescript
import React, { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Box } from "@mui/material";
import { ThemeProvider } from "@mcp-ui/core";
import { Header } from "../components/Header.component";
import { useAuthFetch } from "../utils/api.util";
import type { UserProfile } from "@mcp-ui/types";
```

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing.

### Route Files

Routes are defined in `src/routes/`:

- `__root.tsx` - Root route and layout
- `index.tsx` - Home page (`/`)
- `login.tsx` - Login page (`/login`)

Each route file exports a `Route` object created with `createFileRoute`.

### Adding New Routes

1. Create a new file in `src/routes/`
2. Define the route using `createFileRoute`
3. The route tree will auto-generate on save

Example route:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "../views/Dashboard.view";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});
```

### Protected Routes

Protected routes use the `Authorized.layout.tsx` wrapper which handles authentication checks:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { AuthorizedLayout } from "../layouts/Authorized.layout";

export const Route = createFileRoute("/_authorized")({
  component: AuthorizedLayout,
});
```

## Authentication

This app uses Auth0 for authentication with the following flow:

1. **Login** - Users are redirected to Auth0 for authentication
2. **Token Management** - Tokens are stored in localStorage with refresh token support
3. **Protected Routes** - Routes wrapped in `AuthorizedLayout` require authentication
4. **API Calls** - Use `useAuthFetch` hook to make authenticated API requests

### Using Authenticated API Calls

```typescript
import { useAuthFetch } from "../utils/api.util";

const MyComponent = () => {
  const { fetchWithAuth } = useAuthFetch();

  const fetchData = async () => {
    const response = await fetchWithAuth("/api/profile");
    const data = await response.json();
    return data;
  };

  // Use with TanStack Query
  const { data } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const response = await fetchWithAuth("/api/profile");
      return response.json();
    },
  });
};
```

### Getting Auth0 Tokens for Testing

When testing API endpoints in Swagger or other tools:

1. Log in to the web app at `http://localhost:3000`
2. Open Browser DevTools (F12)
3. Go to **Application** → **Local Storage** → `http://localhost:3000`
4. Find the Auth0 key (starts with `@@auth0spajs@@`)
5. Copy the `access_token` value
6. Use this token in the `Authorization: Bearer <token>` header

## Theming

The app supports three themes managed by the `@mcp-ui/core` package:

- **Brand** - Custom branded theme (default)
- **Light** - Light mode
- **Dark** - Dark mode

Theme preference is stored in localStorage and persists across sessions.

### Switching Themes

Use the `ThemeSwitcher` component (in navbar) or programmatically:

```typescript
import { useTheme } from "@mcp-ui/core";

const MyComponent = () => {
  const { theme, setTheme } = useTheme();

  const switchToDark = () => {
    setTheme("dark");
  };
};
```

## Testing

### Running Tests

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Writing Tests

Tests use Jest with React Testing Library. Place test files next to the components they test or in `__tests__/` directories.

```typescript
import { render, screen } from "@testing-library/react";
import { Header } from "./Header.component";

describe("Header", () => {
  it("renders the title", () => {
    render(<Header title="Test" />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
```

### Test Coverage

Minimum coverage thresholds are configured at 60% for:
- Branches
- Functions
- Lines
- Statements

## Storybook

Storybook is configured for component development and documentation.

### Running Storybook

```bash
npm run storybook
```

Storybook will start at `http://localhost:6007`.

### Writing Stories

Create `*.stories.tsx` files in `src/stories/`:

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { Header } from "../components/Header.component";

const meta: Meta<typeof Header> = {
  title: "Components/Header",
  component: Header,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Header>;

export const Default: Story = {
  args: {
    title: "My Header",
  },
};
```

## Code Quality

### Linting

ESLint is configured with TypeScript and React rules:

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Formatting

Prettier is configured for consistent code style:

```bash
# Format all files
npm run format

# Check formatting
npm run format:check
```

### Type Checking

Run TypeScript compiler without emitting files:

```bash
npm run type-check
```

## Monorepo Packages

This app depends on internal monorepo packages:

- **`@mcp-ui/core`** - Shared UI components, themes, and utilities
- **`@mcp-ui/types`** - Shared TypeScript type definitions

When making changes to these packages, rebuild them:

```bash
# From monorepo root
npm run build
```

## Troubleshooting

### Module Not Found: `@mcp-ui/core`

**Solution:** Build the packages first
```bash
npm run build
```

### Auth0 Errors

**Unexpected 'aud' value:**
- Ensure `VITE_AUTH0_AUDIENCE` matches the API's `AUTH0_AUDIENCE`
- Check that `getAccessTokenSilently` includes the audience parameter

**Invalid Token:**
- Clear browser localStorage and log in again
- Verify Auth0 application configuration

### Route Not Found

**Solution:** Restart the dev server to regenerate the route tree
```bash
npm run dev
```

## Environment URLs

- **Web App**: http://localhost:3000
- **API Server**: http://localhost:3001
- **Swagger Docs**: http://localhost:3001/api-docs
- **Storybook**: http://localhost:6007

## Additional Resources

- [React Documentation](https://react.dev/)
- [TanStack Router](https://tanstack.com/router)
- [TanStack Query](https://tanstack.com/query)
- [Material UI](https://mui.com/)
- [Auth0 React SDK](https://auth0.com/docs/quickstart/spa/react)
- [Vite](https://vitejs.dev/)
- [Storybook](https://storybook.js.org/)
