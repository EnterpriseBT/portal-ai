# MCP UI API

Express API server for the MCP UI application with Auth0 JWT authentication.

## Features

- ✅ Health check endpoints
- ✅ JWT-based authentication with Auth0
- ✅ Automatic API documentation with Swagger/OpenAPI
- ✅ Request/response logging with Pino
- ✅ CORS support
- ✅ TypeScript

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or pnpm

### Environment Variables

Create a `.env` file in the API directory with the following variables:

```env
PORT=3000
CORS_ORIGIN=http://localhost:5173
AUTH0_AUDIENCE=your-auth0-audience
AUTH0_ISSUER=https://your-domain.auth0.com/
```

### Development

```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

### API Documentation

#### Viewing Swagger UI

Once the server is running, visit:

- **Swagger UI**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
- **OpenAPI Spec (JSON)**: [http://localhost:3000/api-docs/spec](http://localhost:3000/api-docs/spec)

The documentation is **auto-generated** from JSDoc comments in the route files and updates automatically during development.

#### Generating Static OpenAPI Spec

To generate a static `swagger.json` file:

```bash
npm run swagger:generate
```

This is useful for:
- Committing to version control
- CI/CD pipelines
- External documentation tools
- API client generation (e.g., with openapi-generator)

#### Watch Mode for Spec Generation

To automatically regenerate `swagger.json` whenever route files change:

```bash
npm run swagger:watch
```

### Adding New API Routes

When adding new routes, document them using OpenAPI JSDoc comments:

```typescript
/**
 * @openapi
 * /api/example:
 *   get:
 *     tags:
 *       - Example
 *     summary: Example endpoint
 *     description: Detailed description of what this endpoint does
 *     security:
 *       - bearerAuth: []  # If authentication is required
 *     responses:
 *       200:
 *         description: Success response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 */
router.get("/example", (req, res) => {
  res.json({ message: "Hello World" });
});
```

The Swagger documentation will automatically include your new routes!

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run type-check` - Run TypeScript type checking
- `npm run swagger:generate` - Generate static OpenAPI spec file
- `npm run swagger:watch` - Watch mode for spec generation

## API Endpoints

### Health

- `GET /health` - Health check endpoint

### Swagger Docs

- `GET /docs` - Swagger UI
- `GET /docs/spec` - OpenAPI spec in JSON format

### Protected (requires JWT)

- `[GET|POST|PUT|DELETE] /api/<path>` - Protected API endpoints (e.g., `/api/users`, `/api/data`)

## Project Structure

```
src/
├── config/           # Configuration files
│   └── swagger.config.ts
├── middleware/       # Express middleware
│   ├── auth.middleware.ts
│   └── logger.middleware.ts
├── routes/           # API routes
│   ├── health.router.ts
│   ├── protected.router.ts
│   └── swagger.router.ts
├── scripts/          # Utility scripts
│   └── generate-swagger.ts
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
│   └── logger.util.ts
├── app.ts           # Express app configuration
├── environment.ts   # Environment variables
└── index.ts         # Server entry point
```

## Authentication

This API uses Auth0 JWT tokens for authentication. Protected routes require a valid JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

You can test protected endpoints using the Swagger UI by clicking the "Authorize" button and entering your JWT token.
