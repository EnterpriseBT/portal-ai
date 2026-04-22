# Portal.ai API

Express API server for the Portal.ai application with Auth0 JWT authentication.

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

### Layout Plans (spreadsheet parsing)

Plan-driven interpretation + commit for uploaded/linked spreadsheets. See [`docs/SPREADSHEET_PARSING.backend.spec.md`](../../docs/SPREADSHEET_PARSING.backend.spec.md) for the full spec.

- `POST /api/connector-instances/:connectorInstanceId/layout-plan/interpret` — run `interpret()` against an inline workbook + region hints; persists the resulting `LayoutPlan` as the current revision and supersedes any prior.
- `GET /api/connector-instances/:connectorInstanceId/layout-plan[?include=interpretationTrace]` — fetch the current plan. `interpretationTrace` is stripped unless the caller opts in.
- `PATCH /api/connector-instances/:connectorInstanceId/layout-plan/:planId` — shallow-merge a partial `LayoutPlan` onto the stored plan; re-validated through `LayoutPlanSchema` before persistence.
- `POST /api/connector-instances/:connectorInstanceId/layout-plan/:planId/commit` — runs `replay(plan, workbook)`, gates on drift + blocker warnings, materializes one `ConnectorEntity` per distinct `targetEntityDefinitionId`, reconciles `FieldMapping` rows across regions (deduped by `ColumnDefinition`), writes `entity_records`. Returns `{ connectorEntityIds, recordCounts }`.
  - 409 `LAYOUT_PLAN_BLOCKER_WARNINGS` — plan has regions with blocker-severity warnings; body carries `details.warnings`.
  - 409 `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` / `_BLOCKER` / `_HALT` — replay detected drift; body carries `details.drift: DriftReport`.

The legacy `POST /api/uploads/*` flow is retained for the simple-layout fast path and scheduled for retirement per [`docs/FILE_UPLOAD_DEPRECATION.plan.md`](../../docs/FILE_UPLOAD_DEPRECATION.plan.md).

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

## Database Schema Workflow

This project enforces a **dual-schema** approach — hand-written Zod models in `@portalai/core` and Drizzle table definitions in the API. Compile-time type assertions guarantee they never drift apart.

| Layer | Location | Purpose |
|---|---|---|
| **Zod models** | `packages/core/src/models/` | Business models shared across the monorepo (API + web) |
| **Drizzle tables** | `apps/api/src/db/schema/` | Database table definitions (API only) |

### Creating a New Table

#### 1. Define the Zod model in `@portalai/core`

Create `packages/core/src/models/foo.model.ts`:

```typescript
import { z } from "zod";
import { CoreObjectSchema } from "./base.model.js";

export const FooSchema = CoreObjectSchema.extend({
  title: z.string(),
  description: z.string().nullable(),
});

export type Foo = z.infer<typeof FooSchema>;
```

`CoreObjectSchema` provides `id`, `created`, `createdBy`, `updated`, `updatedBy`, `deleted`, `deletedBy` for free. Re-export from `packages/core/src/models/index.ts`.

#### 2. Define the Drizzle table

Create `apps/api/src/db/schema/foo.table.ts`:

```typescript
import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

export const foos = pgTable("foos", {
  ...baseColumns,       // auto-derived from CoreObjectSchema
  title: text("title").notNull(),
  description: text("description"),
});
```

`baseColumns` dynamically derives Drizzle columns from `CoreObjectSchema` — strings become `text()`, numbers become `bigint()`, and nullability is preserved. Export the table from `apps/api/src/db/schema/index.ts`.

#### 3. Generate drizzle-zod validation schemas

Add entries in `apps/api/src/db/schema/zod.ts`:

```typescript
import { foos } from "./foo.table.js";

export const FooSelectSchema = createSelectSchema(foos);
export const FooInsertSchema = createInsertSchema(foos);
export type FooSelect = z.infer<typeof FooSelectSchema>;
export type FooInsert = z.infer<typeof FooInsertSchema>;
```

#### 4. Add compile-time type guards

Add assertions in `apps/api/src/db/schema/type-checks.ts`:

```typescript
import type { Foo } from "@portalai/core/models";
import type { FooSelect } from "./zod.js";

type _FooDrizzleToModel = IsAssignable<FooSelect, Foo>;
const _fooDrizzleToModel: _FooDrizzleToModel = true;

type _FooModelToDrizzle = IsAssignable<Foo, FooSelect>;
const _fooModelToDrizzle: _FooModelToDrizzle = true;
```

If the Zod model and Drizzle table ever disagree on field names, types, or nullability, **the build fails**.

#### 5. Generate and apply the migration

```bash
cd apps/api
npm run db:generate -- --name <descriptive-name>  # creates a named .sql migration file
npm run db:migrate                                # applies versioned migrations
# OR
npm run db:push        # pushes schema directly (dev convenience)
```

### Extending an Existing Table

1. **Update the Zod model** in `packages/core/src/models/` — add the new field to the schema.
2. **Update the Drizzle table** in `apps/api/src/db/schema/` — add the matching column.
3. **Build** — run `npm run build` from the root. The type-check guards will fail if one side was updated without the other.
4. **Generate & apply the migration** — `npm run db:generate -- --name <descriptive-name>` then `npm run db:migrate`.

### How the Safety Net Works

```
  @portalai/core                          apps/api
  ┌──────────────┐                     ┌──────────────────┐
  │ UserSchema   │◄── IsAssignable ──►│ UserSelectSchema  │
  │ (Zod)        │    (type-checks.ts) │ (drizzle-zod)     │
  └──────────────┘                     └────────┬─────────┘
                                                │ createSelectSchema()
                                       ┌────────┴─────────┐
                                       │ users table       │
                                       │ (Drizzle pgTable) │
                                       └────────┬─────────┘
                                                │ baseColumns
                                       ┌────────┴─────────┐
                                       │ CoreObjectSchema   │
                                       │ (auto-derived)    │
                                       └──────────────────┘
```

### Database Scripts

- `npm run db:generate -- --name <descriptive-name>` — Generate named SQL migration from schema changes
- `npm run db:migrate` — Run pending migrations
- `npm run db:push` — Push schema directly (dev only)
- `npm run db:studio` — Open Drizzle Studio GUI
- `npm run db:seed` — Seed the database

### Connecting to the dev database

The `portalai-dev` RDS instance lives in private subnets and has no public endpoint. Tunnel through the SSM-managed bastion (`infra/cloudformation/bastion.yml`) using `scripts/db-tunnel.sh`:

```
./scripts/db-tunnel.sh tunnel       # open tunnel on localhost:15432; Ctrl+C to close
./scripts/db-tunnel.sh psql         # interactive psql through the tunnel
./scripts/db-tunnel.sh reset        # truncate all tables (destructive)
./scripts/db-tunnel.sh seed         # run db:seed:ci as a one-off ECS task
./scripts/db-tunnel.sh reset-seed   # truncate, then seed
```

Point SQLTools / Drizzle Studio / any PostgreSQL client at `localhost:15432`. Credentials come from `portalai/dev/database-url` in Secrets Manager; the script fetches and prints them on tunnel start.

The dev container (`/workspace/Dockerfile`) ships with `aws-cli`, `session-manager-plugin`, and `postgresql-client` preinstalled — no local setup required. AWS credentials must have `ssm:StartSession` on the bastion instance; the bastion itself is created/updated by the `Deploy bastion stack` step in `.github/workflows/deploy-dev.yml`.

Override via env vars: `ENV=dev LOCAL_PORT=15432 ./scripts/db-tunnel.sh ...`.

#### Using SQLTools alongside `db-tunnel.sh`

Keep a long-lived tunnel open for your SQLTools session, and run any destructive script (`reset`, `reset-seed`, `psql`) on a different local port so the two don't fight over `15432`.

1. **Open the persistent tunnel** in a dedicated terminal and leave it running:

   ```
   ./scripts/db-tunnel.sh tunnel
   ```

2. **Configure SQLTools** to point at the tunnel. Add a connection to `.vscode/settings.json` (or use the SQLTools UI):

   ```jsonc
   {
     "sqltools.connections": [
       {
         "name": "portalai-dev (tunnel)",
         "driver": "PostgreSQL",
         "server": "localhost",
         "port": 15432,
         "database": "portal_ai",
         "username": "portalai",
         "askForPassword": true,
         "pgOptions": { "ssl": { "rejectUnauthorized": false } }
       }
     ]
   }
   ```

   RDS requires TLS, so `ssl` must be enabled. Paste the password from the `PGPASSWORD=...` hint the tunnel prints on startup.

3. **Run destructive commands on a second port** so they don't collide with the SQLTools tunnel:

   ```
   LOCAL_PORT=15433 ./scripts/db-tunnel.sh reset-seed
   ```

   After `reset-seed`, reconnect in SQLTools (the Refresh icon on the connection) — its pooled connections still reference the pre-truncate snapshot.

If a run ever dies uncleanly, check for orphan plugins with `ps -ef | grep session-manager-plugin` and kill any that are no longer a child of an `aws` process.

## Repositories

Every Drizzle table gets a corresponding repository class that extends the generic `Repository<TTable, TSelect, TInsert>` base class. The base class provides type-safe CRUD operations with built-in soft-delete awareness — all reads and updates automatically skip rows where `deleted IS NOT NULL`.

### Updating Records

The base repository exposes three update methods. All three ignore soft-deleted rows and accept an optional `DbClient` parameter for transaction support.

#### `update(id, data, client?)` — Single row by ID

```typescript
const updated = await usersRepo.update("user-123", { email: "new@example.com" });

if (!updated) {
  // Row not found or already soft-deleted
}
```

Returns the updated row, or `undefined` if the ID does not exist or the row is soft-deleted.

#### `updateWhere(where, data, client?)` — Multiple rows matching a condition

Applies the same partial update to every row matching a `where` clause.

```typescript
import { eq } from "drizzle-orm";
import { users } from "../db/schema/index.js";

const updated = await usersRepo.updateWhere(
  eq(users.role, "guest"),
  { role: "member" }
);
// updated: array of all rows that were changed
```

#### `updateMany(payloads, client?)` — Bulk update with per-row data

Each payload carries its own `id` and `data`, so every row can receive different values. The operation runs inside a transaction for atomicity (or re-uses an existing one).

```typescript
const updated = await usersRepo.updateMany([
  { id: "user-1", data: { displayName: "Alice" } },
  { id: "user-2", data: { displayName: "Bob" } },
]);
// Non-existent or soft-deleted IDs are silently skipped
```

### Using Transactions

Wrap cross-repository writes in a transaction so they commit or roll back as a unit.

#### Callback-based (recommended)

```typescript
const result = await Repository.transaction(async (tx) => {
  const org = await orgsRepo.create({ name: "Acme" }, tx);
  await orgUsersRepo.create({ organizationId: org.id, userId: "user-1" }, tx);
  return org;
});
```

#### Manual commit / rollback

```typescript
const { tx, commit, rollback } = await Repository.createTransactionClient();
try {
  await usersRepo.update("user-1", { role: "admin" }, tx);
  await auditRepo.create({ action: "PROMOTE", targetId: "user-1" }, tx);
  await commit();
} catch (err) {
  await rollback();
  throw err;
}
```

### Creating a Concrete Repository

1. Extend the base class with the table's types.
2. Add custom query methods as needed.
3. Export a singleton instance.

```typescript
import { Repository } from "./base.repository.js";
import { foos } from "../schema/index.js";
import type { FooSelect, FooInsert } from "../schema/zod.js";

class FoosRepository extends Repository<typeof foos, FooSelect, FooInsert> {
  constructor() {
    super(foos);
  }
}

export const foosRepo = new FoosRepository();
```

The singleton inherits all base methods (`findById`, `findMany`, `count`, `create`, `createMany`, `update`, `updateWhere`, `updateMany`, `softDelete`, `softDeleteMany`, `hardDelete`, `hardDeleteMany`) with full type safety.

## S3 bucket setup (streaming upload pipeline)

The `FileUploadConnector` pipeline uploads raw bytes directly to S3 via presigned PUT URLs, then streams them back server-side during parse/interpret/commit. The frontend never ships workbook JSON over HTTP.

### Bucket configuration

1. **Create a bucket** named per `UPLOAD_S3_BUCKET` in the target AWS account/region (`UPLOAD_S3_REGION`). Enable default encryption (`SSE-S3`).
2. **CORS policy** — the browser PUTs directly against presigned URLs, so the bucket must allow cross-origin PUT from the web origin:
   ```json
   [
     {
       "AllowedMethods": ["PUT"],
       "AllowedOrigins": ["https://portal.ai", "https://*.portal.ai"],
       "AllowedHeaders": ["Content-Type", "Content-Length"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```
3. **Lifecycle rule** — objects under the `uploads/` prefix are short-lived. Set a lifecycle rule that expires them after 24 hours so abandoned uploads (user closed the tab mid-flow) are cleared automatically:
   ```json
   {
     "Rules": [
       {
         "ID": "expire-abandoned-uploads",
         "Status": "Enabled",
         "Filter": { "Prefix": "uploads/" },
         "Expiration": { "Days": 1 }
       }
     ]
   }
   ```
4. **IAM policy** — the API's execution role needs `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:DeleteObject` against `arn:aws:s3:::${UPLOAD_S3_BUCKET}/${UPLOAD_S3_PREFIX}/*`.

### Application-side sweeper

On every cold-start, `FileUploadSessionService.sweepStaleUploads()` soft-deletes `file_uploads` rows older than 24 h in any non-`committed` state and best-effort deletes their S3 objects. The lifecycle rule above is the durability guarantee; the sweeper is a UI-visible cleanup so admin views don't show zombie draft rows.

### Observability

Pino log events from the pipeline (filter on `event:`):
- `upload.presign.issued` — counts + total declared bytes per presign call.
- `upload.confirmed` — one per `POST /api/file-uploads/confirm` success.
- `upload.parse.completed` — `sheetCount`, `fileCount`, `sliced`, `durationMs`.
- `upload.cache.miss` — fired when `resolveWorkbook` re-streams from S3 because the Redis cache expired (or was evicted).
- `upload.sweep.started` — startup sweeper with `count` of rows being purged.

## Authentication

This API uses Auth0 JWT tokens for authentication. Protected routes require a valid JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

You can test protected endpoints using the Swagger UI by clicking the "Authorize" button and entering your JWT token.

## Include / Join Convention

Routes are **not** responsible for handling join logic. The router intakes an `include` query parameter, parses it, and passes the resulting array to repository methods. The repository layer owns the actual join or batch-loading implementation. This pattern applies primarily to **GET requests** (list and detail endpoints).

### URL Standard

Standard query parameters for list endpoints:

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `int` | Max rows to return |
| `offset` | `int` | Number of rows to skip |
| `sortBy` | `string` | Column to sort by |
| `sortOrder` | `asc \| desc` | Sort direction |
| `search` | `string` | Case-insensitive keyword search |
| `include` | `string` | Comma-separated list of related data to include |

The specific values accepted by `include` are determined at an endpoint level — each endpoint defines which relations it supports. Additional custom parameters (single strings or comma-separated) are allowed per endpoint.

```
GET /api/connector-entities?include=fieldMappings,connectorInstance,tags&limit=20&offset=0&sortOrder=asc&sortBy=created&search=customer
```

### Router Parsing

The router splits the comma-separated `include` value and passes it as a string array:

```typescript
const { limit, offset, sortBy, sortOrder, search, include } = req.query;
const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

const listOpts = {
  limit,
  offset,
  orderBy: { column, direction: sortOrder },
  include: include_,
};

const results = await DbService.repository.foos.findMany(where, listOpts);
```

### Repository Implementation

Concrete repositories extend `ListOptions` with `include?: string[]` and override `findMany` (or add custom finders) to handle the join logic:

```typescript
interface FoosListOptions extends ListOptions {
  include?: string[];
}

class FoosRepository extends Repository<typeof foos, FooSelect, FooInsert> {
  async findMany(
    where: SQL | undefined,
    opts: FoosListOptions = {},
    client: DbClient = db,
  ): Promise<FooSelect[]> {
    if (opts.include?.includes("bar")) {
      return this.findManyWithBar(where, opts, client);
    }
    return super.findMany(where, opts, client);
  }
}
```

Two patterns are used depending on the relationship cardinality:

1. **LEFT JOIN** — for 1-to-1 relations. Directly joins tables in the query using `getTableColumns()` and Drizzle's `.leftJoin()`.
2. **Post-query batch-loading** — for 1-to-many relations. Fetches base rows first, then loads related data in parallel via `Promise.all()` and maps them back.

### OpenAPI Documentation

Every list endpoint that accepts `include` must document the supported values in its `@openapi` JSDoc:

```typescript
/**
 * @openapi
 *   - in: query
 *     name: include
 *     schema:
 *       type: string
 *     description: "Comma-separated list of related data to include — bar, baz"
 */
```

### Currently Supported Includes

| Endpoint | Supported `include` values |
|----------|---------------------------|
| `GET /api/connector-entities` | `fieldMappings`, `connectorInstance`, `tags` |
| `GET /api/connector-instances` | `connectorDefinition` |
| `GET /api/entity-groups` | `memberCount` |
| `GET /api/field-mappings` | `connectorEntity`, `columnDefinition` |

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

## Troubleshooting

### Auth0 login bounces back to the app with `access_denied`

**Symptom.** Users are redirected from Auth0 to `https://<app>/?error=access_denied&error_description=Request%20failed%20with%20status%20code%20500`. Auth0 tenant logs show an `actions_execution_failed` event on the `Handle Login` post-login action with `action_error.message = "Request failed with status code 500"`.

The action calls `POST /api/webhooks/auth0/sync` on startup-sync. If that endpoint returns non-2xx, Auth0 aborts the login.

**Check the API logs** for the matching request. The catch-all error handler will emit a line like:

```
{ code: "WEBHOOK_SYNC_FAILED", status: 500, msg: "ApiError caught by error handler" }
```

Look at the preceding log line from `module: "webhook"` — its `error.cause` field contains the real root cause. Common causes and fixes below.

#### Postgres `28P01` — password authentication failed

The app's `DATABASE_URL` secret is out of sync with the live DB password. Happens when the RDS master password rotates (or is reset) but the app-facing `portalai/<env>/database-url` secret isn't updated. Rotation is currently **disabled** on non-production environments, but the two secrets can still drift via snapshot restores, manual `ALTER USER`, or re-enabling rotation.

**Fix — rewrite the app secret from the RDS-managed secret, then restart ECS tasks:**

```bash
ENV=dev  # or whichever environment

# 1. Find the RDS-managed secret ARN for this env's DB
MASTER_SECRET_ARN=$(aws rds describe-db-instances \
  --db-instance-identifier "portalai-${ENV}" \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)

# 2. Read the live password and build a fresh DATABASE_URL
NEW_URL=$(python3 <<PY
import json, subprocess, urllib.parse
raw = subprocess.check_output([
  "aws","secretsmanager","get-secret-value",
  "--secret-id","$MASTER_SECRET_ARN",
  "--query","SecretString","--output","text"
]).decode()
d = json.loads(raw)
pw = urllib.parse.quote(d["password"], safe="")
host = f"portalai-${ENV}.cg9sw0okylia.us-east-1.rds.amazonaws.com"
print(f"postgresql://{d['username']}:{pw}@{host}:5432/portal_ai?sslmode=require")
PY
)

# 3. Overwrite the app-facing secret
aws secretsmanager put-secret-value \
  --secret-id "portalai/${ENV}/database-url" \
  --secret-string "$NEW_URL"

# 4. Force ECS to pull the new value (secrets are only read at task start)
aws ecs update-service \
  --cluster "portalai-${ENV}" \
  --service "portalai-api-${ENV}" \
  --force-new-deployment
```

Rollout takes a few minutes — the ALB drains the old task (default 300s deregistration delay) while the new task comes up with fresh credentials.

**Longer-term fix.** For any environment that enables password rotation, the above procedure is manual toil. The structural solution is RDS Proxy with IAM auth from the app: the proxy handles the DB password via Secrets Manager (rotation-safe), and the app authenticates to the proxy via short-lived IAM tokens (no static secret). Revisit when a production environment is provisioned.

