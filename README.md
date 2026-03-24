# Portal.ai

A Turborepo monorepo for displaying dynamic UI content from a Model-Controller-Presenter architecture.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Material UI, TanStack Router/Query, Auth0
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM, PostgreSQL, Auth0 JWT
- **Shared**: Zod domain models, MUI component library
- **Tooling**: Turborepo, ESLint, Prettier, Jest, Storybook

## Monorepo Structure

```
apps/
  web/          → React frontend (localhost:3000)
  api/          → Express API server (localhost:3001)
packages/
  core/         → Shared UI components, themes, and Zod domain models
```

## Getting Started

### Prerequisites

- Node.js v18+
- npm 10+
- PostgreSQL (for API)

### Setup

```bash
# Install dependencies
npm install

# Build all packages (required on first run)
npm run build

# Start all dev servers
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` in each app directory:

- `apps/web/.env` — Auth0 client config (`VITE_AUTH0_*`)
- `apps/api/.env` — Auth0 API config, database URL, CORS settings

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all dev servers |
| `npm run build` | Build all packages |
| `npm run test` | Run tests across monorepo |
| `npm run lint` | Lint all packages |
| `npm run format` | Format all packages |
| `npm run type-check` | TypeScript validation |
| `npm run storybook` | Start Storybook servers |

## Documentation

Each package has detailed documentation in its README:

- [`apps/web/README.md`](apps/web/README.md) — Frontend setup, routing, auth, theming, testing
- [`apps/api/README.md`](apps/api/README.md) — API setup, database schema workflow, repositories, style guide
- [`packages/core/README.md`](packages/core/README.md) — Component library, model architecture, theme system
