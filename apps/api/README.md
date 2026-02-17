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

## Style Guide

### Services

Services should export classes with methods instead of exporting single functions.

```typescript
// ✅ Good — class with methods
export class UserService {
  public static async getById(id: string): Promise<User> {
    logger.info({ id }, "Fetching user by ID");
    // ...
  }

  public static async update(id: string, data: UpdateUserDto): Promise<User> {
    logger.info({ id }, "Updating user");
    // ...
  }
}

// ❌ Bad — loose exported functions
export async function getUser(id: string) { /* ... */ }
export async function updateUser(id: string, data: UpdateUserDto) { /* ... */ }
```

### Logging

Routes, services, and database queries should log every action.

```typescript
// In a route handler
profileRouter.get("/", async (req, res, next) => {
  logger.info({ userId: req.auth?.payload.sub }, "GET /api/profile called");
  // ...
});

// In a service method
export class Auth0Service {
  public static async getAuth0UserProfile(accessToken: string): Promise<Auth0UserProfile> {
    logger.debug({ url: userInfoUrl }, "Fetching user profile from Auth0");
    const response = await fetch(userInfoUrl, { /* ... */ });
    logger.info({ sub: userProfile.sub }, "Successfully fetched user profile");
    return userProfile;
  }
}

// In a database query
export class UserRepository {
  public static async findById(id: string): Promise<User | null> {
    logger.debug({ id }, "Querying user by ID");
    const user = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    logger.info({ id, found: !!user }, "User query complete");
    return user;
  }
}
```

### Request Validation

Routes should validate request parameters/body using middleware, and extend the express object for type safety.

```typescript
// Define a typed request interface extending Express
interface GetUserRequest extends Request {
  params: { userId: string };
}

// Validation middleware
function validateGetUser(req: Request, _res: Response, next: NextFunction) {
  const { userId } = req.params;
  if (!userId || typeof userId !== "string") {
    return next(new ApiError(400, ApiCode.USER_INVALID_ID, "Invalid user ID"));
  }
  next();
}

// Use the middleware on the route
userRouter.get("/:userId", validateGetUser, async (req: GetUserRequest, res, next) => {
  // req.params.userId is guaranteed to be a valid string here
});
```

### Response Validation

Routes should validate the response before sending payload.

```typescript
userRouter.get("/:userId", validateGetUser, async (req: GetUserRequest, res, next) => {
  try {
    const user = await UserService.getById(req.params.userId);

    // Validate the response payload before sending
    if (!user || !user.id || !user.email) {
      return next(new ApiError(500, ApiCode.USER_MALFORMED_RESPONSE, "Malformed user response"));
    }

    return HttpService.success(res, { user });
  } catch (error) {
    return next(error);
  }
});
```

### Error Handling

Handle all errors using the `ApiError` class. Pass them into the `next()` function so that all errors are funneled to the catch-all error handler consistently.

```typescript
// ✅ Good — throw ApiError and pass to next()
profileRouter.get("/", async (req, res, next) => {
  try {
    const accessToken = req.headers.authorization?.substring(7);
    if (!accessToken) {
      return next(new ApiError(401, ApiCode.PROFILE_MISSING_TOKEN, "Missing access token"));
    }

    const profile = await Auth0Service.getAuth0UserProfile(accessToken);
    return HttpService.success(res, { profile });
  } catch (error) {
    // Wrap unknown errors in ApiError before passing to next()
    if (error instanceof ApiError) {
      return next(error);
    }
    return next(new ApiError(500, ApiCode.PROFILE_FETCH_FAILED, "Failed to fetch profile"));
  }
});

// ❌ Bad — sending error responses directly in the route
profileRouter.get("/", async (req, res) => {
  try {
    // ...
  } catch (error) {
    res.status(500).json({ message: "Something went wrong" }); // Bypasses error handler
  }
});
```

### API Error Codes

Error codes are unique enum strings defined in `ApiCode` (see [src/constants/api-codes.constants.ts](src/constants/api-codes.constants.ts)). They identify specific points of failure in a route or service, making production debugging straightforward. Every `ApiError` must include one.

Codes follow the format `<DOMAIN>_<FAILURE>` — the domain identifies the route or service, and the failure describes what went wrong.

```typescript
// src/constants/api-codes.constants.ts
export enum ApiCode {
  // Profile
  PROFILE_MISSING_TOKEN = "PROFILE_MISSING_TOKEN",
  PROFILE_FETCH_FAILED  = "PROFILE_FETCH_FAILED",

  // User
  USER_INVALID_ID         = "USER_INVALID_ID",
  USER_NOT_FOUND          = "USER_NOT_FOUND",
  USER_MALFORMED_RESPONSE = "USER_MALFORMED_RESPONSE",

  // Auth
  AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED",
  AUTH_UNAUTHORIZED  = "AUTH_UNAUTHORIZED",
}
```

When adding a new route or service, add corresponding error codes to the enum:

```typescript
// Usage in a route
return next(new ApiError(404, ApiCode.USER_NOT_FOUND, "User not found"));

// The client receives a structured error response:
// {
//   "success": false,
//   "message": "User not found",
//   "code": "USER_NOT_FOUND"
// }
```

This makes it possible to search logs and error tracking tools by code (e.g. `USER_NOT_FOUND`) to pinpoint the exact failure location without relying on ambiguous status codes or message strings.
