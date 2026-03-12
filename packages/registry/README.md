# @mcp-ui/registry

Dynamic UI catalog registry for MCP UI, built on [@json-render](https://github.com/nicholasgriffintn/json-render).

## Overview

The registry provides a centralized system for managing dynamic component catalogs. Each catalog defines a set of components with Zod-validated props and corresponding React implementations, enabling schema-driven UI rendering.

## Architecture

```
registry/src/
├── index.tsx              # Barrel exports
├── types.ts               # CatalogName enum
├── registry.ts            # Singleton registry with registered catalogs
├── catalogs/              # One directory per catalog
│   └── Blog/
│       └── index.tsx      # Blog catalog definition + React components
└── utils/
    └── registry.util.ts   # Registry class and RegistryEntry interface
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Registry** | A generic `Map`-based store that holds `RegistryEntry` objects keyed by `CatalogName` |
| **RegistryEntry** | An object containing the catalog `name`, its `DefineRegistryResult` (React bindings), and the `Catalog` (schema) |
| **Catalog** | Defined via `defineCatalog()` from `@json-render/core` — declares available components and their Zod prop schemas |
| **Registry Definition** | Defined via `defineRegistry()` from `@json-render/react` — maps catalog components to React implementations |

## Usage

```tsx
import { registry, CatalogName } from "@mcp-ui/registry";

// Retrieve a registered catalog
const blogEntry = registry.get(CatalogName.Blog);

if (blogEntry) {
  const { definition, catalog } = blogEntry;
  // Use definition for rendering, catalog for schema introspection
}
```

## Adding a New Catalog

Use `catalogs/Blog/` as the reference implementation.

### 1. Add the catalog name to the enum

In `src/types.ts`:

```typescript
export enum CatalogName {
  Blog = "blog",
  Chat = "chat",
  MyNewCatalog = "my-new-catalog",  // add here
}
```

### 2. Create the catalog directory

Create `src/catalogs/MyNewCatalog/index.tsx`:

```tsx
import { defineCatalog } from "@json-render/core";
import { defineRegistry, schema } from "@json-render/react";
import { z } from "zod";
import { RegistryEntry } from "../../utils/registry.util.js";
import { CatalogName } from "../../types.js";

// Define the catalog schema (components + their Zod prop types)
export const catalog = defineCatalog(schema, {
  components: {
    MyComponent: {
      props: z.object({
        title: z.string().describe("The component title"),
      }),
      description: "Renders a titled section",
    },
  },
  actions: {},
});

// Define the React implementations
export const MyNewCatalog = defineRegistry(catalog, {
  components: {
    MyComponent: ({ props }) => {
      return <h2>{props.title}</h2>;
    },
  },
  actions: {},
});

// Export as a RegistryEntry
export const MyNewCatalogEntry: RegistryEntry<CatalogName> = {
  name: CatalogName.MyNewCatalog,
  definition: MyNewCatalog,
  catalog,
};
```

### 3. Register the catalog

In `src/registry.ts`:

```typescript
import { MyNewCatalogEntry } from "./catalogs/MyNewCatalog/index.js";

registry.register(MyNewCatalogEntry);
```

## Available Catalogs

| Catalog | Enum | Components | Status |
|---------|------|------------|--------|
| Blog | `CatalogName.Blog` | `Markdown` (renders markdown via react-markdown) | Implemented |
| Chat | `CatalogName.Chat` | — | Enum defined, not yet implemented |

## Scripts

```bash
npm run build        # Compile TypeScript to dist/
npm run clean        # Remove dist/
npm run type-check   # TypeScript validation without emit
```

## Dependencies

- `@json-render/core` — Catalog definition and schema system
- `@json-render/react` — React registry bindings
- `@json-render/shadcn` — Shadcn UI component integration
- `ai` — AI SDK integration
- `react-markdown` — Markdown rendering for Blog catalog
