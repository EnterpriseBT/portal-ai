# Integration Tests

This directory contains integration tests that run against a real PostgreSQL database.

## Requirements

- The `postgres-test` container running (via docker-compose)
- Node.js v18 or higher

## Running the Tests

The tests connect to the `postgres-test` container defined in [docker-compose.yml](../../../../../docker-compose.yml).

```bash
# Run all integration tests
npm run test:integration

# Run integration tests with coverage
npm run test:integration -- --coverage
```

The test database is automatically cleaned and migrated before each test run.

## How It Works

1. **Setup** ([setup.ts](./setup.ts)):
   - Connects to the `postgres-test` container (postgresql://postgres-test:5432/mcp_ui_test)
   - Truncates all existing tables
   - Runs all Drizzle migrations from `/drizzle`
2. **Tests**: Integration tests run against the real database, testing actual SQL queries
3. **Teardown** ([teardown.ts](./teardown.ts)): Logs completion (the container keeps running)

## Test Structure

- Tests are located in subdirectories matching the source structure
- All integration test files must match the pattern `*.integration.test.ts`
- Each test file creates its own database connection and cleans up data between tests

## Key Differences from Unit Tests

| Aspect | Unit Tests | Integration Tests |
|--------|-----------|-------------------|
| **Database** | Mocked | Real PostgreSQL |
| **Speed** | Fast (~ms) | Slower (~seconds) |
| **Isolation** | Complete | Database-level |
| **Purpose** | Test logic | Test SQL queries |
| **Config** | `jest.config.js` | `jest.integration.config.js` |
| **Script** | `npm test` | `npm run test:integration` |

## Writing Integration Tests

Example structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Repository } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";

describe("My Integration Tests", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
    // Clean up data before each test
    await db.delete(schema.users);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("should test something", async () => {
    // Your test here
  });
});
```

## Docker Compose Setup

The test database is defined in [docker-compose.yml](../../../../../docker-compose.yml):

```yaml
postgres-test:
  image: postgres:17-alpine
  ports:
    - "5433:5432"  # Exposed on host as localhost:5433
  environment:
    POSTGRES_DB: mcp_ui_test
  tmpfs:
    - /var/lib/postgresql/data  # In-memory for speed
```

The data is stored in tmpfs (RAM) for faster test execution and automatic cleanup on restart.

## Troubleshooting

### Connection Refused

Ensure the postgres-test container is running:

```bash
docker-compose up -d postgres-test
docker-compose ps postgres-test
```

### Migration Errors

If migrations fail, ensure:
1. All migration files exist in `/drizzle`
2. The schema matches the migration expectations
3. The postgres-test database is accessible

### Running Tests from Host

If running tests from outside the dev container, override the database URL:

```bash
INTEGRATION_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/mcp_ui_test" npm run test:integration
```
