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

## Sharding in CI (#857)

CI runs this suite as N shards, each on its own runner with its own Postgres + Redis. The suites can't share a database (`teardownOrg()` deletes every row), so this is the only way to parallelize them. Locally nothing changes: `npm run test:integration` runs everything, serially.

- **The split** is by recorded duration, not file count. [`jest.integration.sequencer.mjs`](../../../jest.integration.sequencer.mjs) bin-packs files using [`durations.json`](./durations.json); a file with no entry weighs the median. It only runs when `--shard` is passed.
- **N** is about 150s of recorded time per shard, clamped to 2–10: `node scripts/integration-shards.mjs plan` from the repo root shows it.
- **Reproduce one shard locally:** `INTEGRATION_SHARD=2/4 npm run test:integration`. It runs exactly the files CI's shard 2 of 4 ran, and writes `jest-integration-report.json`.
- **Keep files under 120s.** A file can't be split across shards, so the slowest file sets the floor on its shard's time. `npm run lint:integration-durations` (root) fails on a file past the ceiling. Split it by concern, as `services/demo-seed.*.integration.test.ts` were, or add it to `CEILING_ALLOWLIST` in `scripts/integration-shards.lib.mjs` with a reason.
- **Refreshing durations.** A weekly workflow opens or updates a drift issue, carrying the exact command, when they drift. To refresh by hand from a CI run:

  ```bash
  # one directory per run; each file's duration becomes its median across them
  for id in <run-id> <run-id> <run-id>; do
    gh run download "$id" -p 'integration-jest-*' -D "/tmp/reports/$id"
  done
  node scripts/integration-shards.mjs update-durations --reports /tmp/reports
  ```

  Then commit `durations.json`. Sample several runs (`node scripts/integration-shards.mjs sample-runs` says how many the weekly job uses): one run is a noisy sample, and the median is what keeps shards even. Use CI times, not a local run: CI runs about 1.75× slower, and the planner budgets CI seconds.

## How It Works

1. **Setup** ([setup.ts](./setup.ts)):
   - Connects to the `postgres-test` container (postgresql://postgres-test:5432/portal_ai_test)
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
    POSTGRES_DB: portal_ai_test
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
INTEGRATION_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/portal_ai_test" npm run test:integration
```
