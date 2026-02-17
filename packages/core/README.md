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

## Models

Domain models are built on a layered schema → class → factory pattern using [Zod](https://zod.dev) for validation.

### Architecture

| Layer | Purpose |
|---|---|
| `CoreObjectSchema` | Zod schema with standard audit fields (`id`, `created`, `createdBy`, `updated`, `updatedBy`, `deleted`, `deletedBy`) |
| `BaseModelClass<T>` | Wraps a `Partial<T>`, exposes `toJSON()`, `validate()`, and `update()` |
| `BaseModelFactory` | Generates base fields (`id` via `IDFactory`, `created` via `DateFactory`, `createdBy`) |
| `ModelFactory<T, M>` | Abstract factory subclasses extend to create domain-specific models |

### Creating a new model

Use `user.model.ts` as the reference implementation.

#### 1. Define the Zod schema

Extend `CoreObjectSchema` with domain-specific fields:

```ts
import { z } from "zod";
import { CoreObjectSchema } from "./base.model.js";

export const WidgetSchema = CoreObjectSchema.extend({
  label: z.string(),
  color: z.string().nullable(),
});

export type Widget = z.infer<typeof WidgetSchema>;
```

#### 2. Create the model class

Extend `BaseModelClass<T>` and override the `schema` getter to return your schema:

```ts
import { BaseModelClass } from "./base.model.js";

export class WidgetModel extends BaseModelClass<Widget> {
  get schema() {
    return WidgetSchema;
  }
}
```

#### 3. Create the model factory

Extend `ModelFactory<T, M>` and implement `create()`. Delegate base-field generation to the inherited `_baseModelFactory`:

```ts
import { ModelFactory } from "./base.model.js";

export class WidgetModelFactory extends ModelFactory<Widget, WidgetModel> {
  create(createdBy: string): WidgetModel {
    const baseModel = this._baseModelFactory.create(createdBy);
    const widgetModel = new WidgetModel(baseModel.toJSON());
    return widgetModel;
  }
}
```

#### 4. Export from the barrel

Add to `models/index.ts`:

```ts
export * from "./widget.model.js";
```

#### 5. Usage

```ts
import { DateFactory } from "@mcp-ui/core/utils";
import { BaseModelFactory, WidgetModelFactory } from "@mcp-ui/core/models";

const dateFactory    = new DateFactory("America/New_York");
const baseFactory    = new BaseModelFactory({ dateFactory });
const widgetFactory  = new WidgetModelFactory({ baseModelFactory: baseFactory });

const widget = widgetFactory.create("user-42");
widget.update({ label: "Sprocket", color: "blue" });

widget.validate(); // { success: true, data: { ... } }
widget.toJSON();   // plain object snapshot
```

### Conventions

- **One file per model** — name it `<entity>.model.ts` and place it in `src/models/`.
- **Schema first** — always define the Zod schema, then derive the `type` with `z.infer`.
- **Extend, don't redefine** — use `CoreObjectSchema.extend({})` so every model inherits the audit fields.
- **Thin factories** — the `create()` method should only call `_baseModelFactory.create()` and wrap the result. Domain-specific fields are set later via `model.update()`.
- **Tests** — add a corresponding `<entity>.model.test.ts` in `__tests__/models/`.

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
