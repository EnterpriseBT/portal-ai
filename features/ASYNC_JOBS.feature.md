# Async Jobs Architecture Specification

## Overview

This document proposes an architecture for managing asynchronous jobs in MCP UI using **BullMQ** (backed by **Redis**) for job queuing and processing, and **Server-Sent Events (SSE)** for real-time job status notifications to the browser. A key requirement is the ability to **recover job state** if the browser refreshes mid-stream.

---

## Goals

1. Queue, process, and monitor long-running async jobs (e.g., data imports, report generation, connector syncs)
2. Push real-time progress updates to the browser via SSE
3. Survive browser refreshes — clients reconnect and receive current job state without data loss
4. Follow existing project conventions (dual-schema, repository pattern, service layer, file naming)

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Job queue | BullMQ | Reliable job scheduling, retries, concurrency control |
| Broker | Redis 7+ | BullMQ backing store, SSE pub/sub fanout |
| Notifications | SSE (Server-Sent Events) | Lightweight server→client push over HTTP |
| Persistence | PostgreSQL (Drizzle) | Durable job records for recovery and audit |

---

## Architecture Diagram

```
┌─────────────┐         POST /api/jobs          ┌──────────────┐
│  Browser     │ ──────────────────────────────► │  API Server  │
│  (React)     │                                 │  (Express)   │
│              │  GET /api/jobs/:id/events (SSE)  │              │
│              │ ◄─────────────────────────────── │              │
└─────────────┘                                  └──────┬───────┘
                                                        │
                                          ┌─────────────┼─────────────┐
                                          │             │             │
                                          ▼             ▼             ▼
                                   ┌───────────┐ ┌───────────┐ ┌──────────┐
                                   │  BullMQ   │ │ PostgreSQL│ │  Redis   │
                                   │  Queue    │ │  (jobs    │ │  Pub/Sub │
                                   │           │ │   table)  │ │          │
                                   └─────┬─────┘ └───────────┘ └──────────┘
                                         │
                                         ▼
                                   ┌───────────┐
                                   │  BullMQ   │
                                   │  Worker   │
                                   │ (in-proc) │
                                   └───────────┘
```

### Flow

1. Client submits a job via `POST /api/jobs`
2. API creates a `jobs` row in PostgreSQL (status: `pending`) and enqueues a BullMQ job
3. Client opens an SSE connection to `GET /api/jobs/:id/events`
4. BullMQ Worker picks up the job, processes it, and emits progress events
5. Worker updates the PostgreSQL row **and** publishes events to a Redis Pub/Sub channel
6. The SSE handler subscribes to the Redis channel and forwards events to the client
7. On browser refresh, the client reconnects — the SSE endpoint reads current state from PostgreSQL and replays it before subscribing to live events

---

## Data Model

### Zod Model — `packages/core/src/models/job.model.ts`

```ts
import { z } from 'zod';

import { CoreObjectSchema, CoreModel, ModelFactory } from './base.model';

// --- Enums ---

export const JobStatus = z.enum([
  'pending',
  'active',
  'completed',
  'failed',
  'stalled',
  'cancelled',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobType = z.enum([
  'connector_sync',
  'data_import',
  'report_generation',
  // extend as new job types are added
]);
export type JobType = z.infer<typeof JobType>;

// --- Schema ---

export const JobSchema = CoreObjectSchema.extend({
  organizationId: z.string(),
  type: JobType,
  status: JobStatus.default('pending'),
  progress: z.number().min(0).max(100).default(0),
  metadata: z.record(z.unknown()).default({}),
  result: z.record(z.unknown()).nullable().default(null),
  error: z.string().nullable().default(null),
  startedAt: z.number().nullable().default(null),
  completedAt: z.number().nullable().default(null),
  bullJobId: z.string().nullable().default(null),
  attempts: z.number().default(0),
  maxAttempts: z.number().default(3),
});

export type Job = z.infer<typeof JobSchema>;

// --- Model Class ---

export class JobModel extends CoreModel<Job> {
  get schema() {
    return JobSchema;
  }
}

// --- Factory ---

export class JobModelFactory extends ModelFactory<Job, JobModel> {
  // ...follows existing pattern from user.model.ts
}
```

### Drizzle Table — `apps/api/src/db/schema/jobs.table.ts`

```ts
import { bigint, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { baseColumns } from './base.columns';

export const jobs = pgTable('jobs', {
  ...baseColumns,
  organizationId: text('organization_id').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  progress: integer('progress').notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
  result: jsonb('result'),
  error: text('error'),
  startedAt: bigint('started_at', { mode: 'number' }),
  completedAt: bigint('completed_at', { mode: 'number' }),
  bullJobId: text('bull_job_id'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
});
```

Follow the dual-schema workflow: generate drizzle-zod schemas in `zod.ts`, add bidirectional type-checks in `type-checks.ts`, then `npm run db:generate && npm run db:migrate`.

---

## Infrastructure

### Redis Setup

Add Redis to `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  ports:
    - '6379:6379'
  volumes:
    - redis-data:/data
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
    timeout: 3s
    retries: 5
  networks:
    - mcp-net
```

Add to API environment (`apps/api/src/environment.ts`):

```ts
REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
```

### Redis Client — `apps/api/src/utils/redis.util.ts`

```ts
import { Redis } from 'ioredis';

import { environment } from '../environment';
import { createLogger } from './logger.util';

const logger = createLogger({ module: 'redis' });

let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis(environment.REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
    redisClient.on('error', (err) => logger.error(err, 'Redis connection error'));
    redisClient.on('connect', () => logger.info('Redis connected'));
  }
  return redisClient;
};

export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
};
```

---

## Queue Layer

### Queue Setup — `apps/api/src/queues/jobs.queue.ts`

```ts
import { Queue } from 'bullmq';

import { getRedisClient } from '../utils/redis.util';

export const JOBS_QUEUE_NAME = 'async-jobs';

export const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: getRedisClient(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 7 * 24 * 3600 },  // 7 days
    removeOnFail: { age: 30 * 24 * 3600 },     // 30 days
  },
});
```

### Worker — `apps/api/src/queues/jobs.worker.ts`

```ts
import { Worker, Job as BullJob } from 'bullmq';

import { getRedisClient } from '../utils/redis.util';
import { createLogger } from '../utils/logger.util';
import { JobEventsService } from '../services/job-events.service';
import { JOBS_QUEUE_NAME } from './jobs.queue';

const logger = createLogger({ module: 'jobs-worker' });

// Registry of processor functions keyed by job type
const processors: Record<string, (job: BullJob) => Promise<unknown>> = {};

export const registerProcessor = (
  type: string,
  fn: (job: BullJob) => Promise<unknown>,
) => {
  processors[type] = fn;
};

export const jobsWorker = new Worker(
  JOBS_QUEUE_NAME,
  async (bullJob) => {
    const { jobId, type } = bullJob.data;
    const processor = processors[type];
    if (!processor) throw new Error(`No processor registered for job type: ${type}`);

    await JobEventsService.transition(jobId, 'active', { progress: 0 });
    try {
      const result = await processor(bullJob);
      await JobEventsService.transition(jobId, 'completed', { progress: 100, result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await JobEventsService.transition(jobId, 'failed', { error: message });
      throw err;
    }
  },
  {
    connection: getRedisClient(),
    concurrency: 5,
  },
);

// Forward BullMQ progress events
jobsWorker.on('progress', async (bullJob, progress) => {
  if (typeof progress === 'number') {
    await JobEventsService.updateProgress(bullJob.data.jobId, progress);
  }
});

jobsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.data?.jobId, err }, 'Job failed');
});
```

### Processor Registration — `apps/api/src/queues/processors/`

Each job type gets its own processor file:

```
apps/api/src/queues/processors/
  connector-sync.processor.ts
  data-import.processor.ts
  report-generation.processor.ts
  index.ts                        # registers all processors
```

Example processor:

```ts
// connector-sync.processor.ts
import { Job as BullJob } from 'bullmq';

import { registerProcessor } from '../jobs.worker';

const processConnectorSync = async (bullJob: BullJob): Promise<unknown> => {
  const { connectorInstanceId } = bullJob.data;
  // ... perform sync work, reporting progress via:
  await bullJob.updateProgress(25);
  // ... more work
  await bullJob.updateProgress(75);
  // ...
  return { recordsSynced: 142 };
};

registerProcessor('connector_sync', processConnectorSync);
```

---

## Event Distribution (Redis Pub/Sub)

### JobEventsService — `apps/api/src/services/job-events.service.ts`

This service is the central point for persisting job state changes and broadcasting them to SSE clients.

```ts
import { getRedisClient } from '../utils/redis.util';
import { createLogger } from '../utils/logger.util';

const logger = createLogger({ module: 'job-events' });

export interface JobEvent {
  jobId: string;
  status: string;
  progress: number;
  error?: string | null;
  result?: Record<string, unknown> | null;
  timestamp: number;
}

const JOB_CHANNEL_PREFIX = 'job:events:';

export class JobEventsService {
  /**
   * Update job row in PostgreSQL AND publish event to Redis.
   */
  static async transition(
    jobId: string,
    status: string,
    patch: Partial<{ progress: number; error: string; result: Record<string, unknown> }> = {},
  ): Promise<void> {
    const now = Date.now();
    const dbPatch: Record<string, unknown> = {
      status,
      updated: now,
      ...patch,
    };
    if (status === 'active') dbPatch.startedAt = now;
    if (status === 'completed' || status === 'failed') dbPatch.completedAt = now;

    // Persist to PostgreSQL
    await DbService.repository.jobs.update(jobId, dbPatch);

    // Broadcast via Redis Pub/Sub
    const event: JobEvent = {
      jobId,
      status,
      progress: patch.progress ?? 0,
      error: patch.error ?? null,
      result: patch.result ?? null,
      timestamp: now,
    };
    const redis = getRedisClient();
    await redis.publish(
      `${JOB_CHANNEL_PREFIX}${jobId}`,
      JSON.stringify(event),
    );
    logger.debug({ jobId, status }, 'Job event published');
  }

  /**
   * Update progress without a status transition.
   */
  static async updateProgress(jobId: string, progress: number): Promise<void> {
    await DbService.repository.jobs.update(jobId, { progress, updated: Date.now() });

    const event: JobEvent = {
      jobId,
      status: 'active',
      progress,
      timestamp: Date.now(),
    };
    const redis = getRedisClient();
    await redis.publish(
      `${JOB_CHANNEL_PREFIX}${jobId}`,
      JSON.stringify(event),
    );
  }

  /**
   * Subscribe to events for a specific job.
   * Returns a cleanup function.
   */
  static subscribe(
    jobId: string,
    onEvent: (event: JobEvent) => void,
  ): () => void {
    // Dedicated subscriber connection (required by Redis for pub/sub)
    const subscriber = getRedisClient().duplicate();
    const channel = `${JOB_CHANNEL_PREFIX}${jobId}`;

    subscriber.subscribe(channel);
    subscriber.on('message', (_ch: string, message: string) => {
      try {
        onEvent(JSON.parse(message));
      } catch (err) {
        logger.error({ err, jobId }, 'Failed to parse job event');
      }
    });

    return () => {
      subscriber.unsubscribe(channel);
      subscriber.disconnect();
    };
  }
}
```

---

## API Routes

### Jobs Router — `apps/api/src/routes/jobs.router.ts`

```ts
import { Router } from 'express';

import { JobsService } from '../services/jobs.service';
import { JobEventsService } from '../services/job-events.service';
import { HttpService } from '../services/http.service';
import { SseUtil } from '../utils/sse.util';

export const jobsRouter = Router();

/**
 * POST /api/jobs
 * Create and enqueue a new job.
 */
jobsRouter.post('/', async (req, res, next) => {
  try {
    const userId = req.auth!.payload.sub!;
    const job = await JobsService.create(userId, req.body);
    HttpService.success(res, job, 201);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs
 * List jobs for the current organization.
 */
jobsRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.auth!.payload.sub!;
    const jobs = await JobsService.listForOrganization(userId, req.query);
    HttpService.success(res, jobs);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs/:id
 * Get a single job by ID.
 */
jobsRouter.get('/:id', async (req, res, next) => {
  try {
    const job = await JobsService.findById(req.params.id);
    HttpService.success(res, job);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs/:id/events
 * SSE stream for real-time job updates.
 * Supports reconnection via Last-Event-ID header.
 */
jobsRouter.get('/:id/events', async (req, res, next) => {
  try {
    const jobId = req.params.id;

    // Verify job exists and user has access
    const job = await JobsService.findById(jobId);

    const sse = new SseUtil(res);

    // 1. Send current state snapshot (recovery on reconnect)
    sse.send('snapshot', {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      result: job.result,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });

    // 2. If job is already terminal, close immediately
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      sse.end();
      return;
    }

    // 3. Subscribe to live updates via Redis Pub/Sub
    const unsubscribe = JobEventsService.subscribe(jobId, (event) => {
      sse.send('update', event);

      // Close stream when job reaches terminal state
      if (['completed', 'failed', 'cancelled'].includes(event.status)) {
        unsubscribe();
        sse.end();
      }
    });

    // 4. Cleanup on client disconnect
    req.on('close', () => {
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobs/:id/cancel
 * Request cancellation of a running job.
 */
jobsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const userId = req.auth!.payload.sub!;
    const job = await JobsService.cancel(req.params.id, userId);
    HttpService.success(res, job);
  } catch (err) {
    next(err);
  }
});
```

Mount in `protected.router.ts`:

```ts
import { jobsRouter } from './jobs.router';
protectedRouter.use('/jobs', jobsRouter);
```

---

## Jobs Service — `apps/api/src/services/jobs.service.ts`

```ts
import { jobsQueue } from '../queues/jobs.queue';
import { DbService } from './db.service';
import { JobEventsService } from './job-events.service';
import { ApiError, ApiCode } from './http.service';
import { createLogger } from '../utils/logger.util';

const logger = createLogger({ module: 'jobs-service' });

export class JobsService {
  static async create(userId: string, params: {
    type: string;
    organizationId: string;
    metadata?: Record<string, unknown>;
  }) {
    // 1. Create DB record
    const job = await DbService.repository.jobs.create({
      organizationId: params.organizationId,
      type: params.type,
      status: 'pending',
      progress: 0,
      metadata: params.metadata ?? {},
      createdBy: userId,
    });

    // 2. Enqueue BullMQ job
    const bullJob = await jobsQueue.add(params.type, {
      jobId: job.id,
      type: params.type,
      ...params.metadata,
    });

    // 3. Store BullMQ reference
    await DbService.repository.jobs.update(job.id, {
      bullJobId: bullJob.id,
    });

    logger.info({ jobId: job.id, type: params.type }, 'Job created and enqueued');
    return { ...job, bullJobId: bullJob.id };
  }

  static async findById(jobId: string) {
    const job = await DbService.repository.jobs.findById(jobId);
    if (!job) throw new ApiError(404, ApiCode.JOB_NOT_FOUND, 'Job not found');
    return job;
  }

  static async listForOrganization(userId: string, query: {
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }) {
    // Resolve user's organization, then list jobs
    const org = await ApplicationService.getCurrentOrganization(userId);
    return DbService.repository.jobs.findMany({
      where: { organizationId: org.id, ...query },
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      orderBy: { column: 'created', direction: 'desc' },
    });
  }

  static async cancel(jobId: string, userId: string) {
    const job = await this.findById(jobId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      throw new ApiError(400, ApiCode.JOB_ALREADY_TERMINAL, 'Job is already in terminal state');
    }

    // Remove from BullMQ if still queued
    if (job.bullJobId) {
      const bullJob = await jobsQueue.getJob(job.bullJobId);
      if (bullJob) await bullJob.remove();
    }

    await JobEventsService.transition(jobId, 'cancelled');
    return this.findById(jobId);
  }
}
```

---

## Browser Recovery Strategy

The core requirement is that a browser refresh mid-job does not lose state. This is achieved through a **snapshot-on-connect** pattern:

### How It Works

```
Browser loads page
  │
  ├─ 1. GET /api/jobs/:id → fetch current state from PostgreSQL
  │
  ├─ 2. GET /api/jobs/:id/events → open SSE connection
  │     │
  │     ├─ Server sends "snapshot" event (current DB state)
  │     ├─ Server subscribes to Redis Pub/Sub for live updates
  │     └─ Server forwards "update" events as they arrive
  │
  └─ 3. React merges snapshot + live updates into UI state
```

### Why This Is Reliable

| Scenario | What Happens |
|----------|-------------|
| Fresh page load | SSE snapshot delivers current state; live updates follow |
| Browser refresh mid-job | Same as fresh load — snapshot has latest persisted state |
| Network blip (SSE reconnect) | `EventSource` auto-reconnects; snapshot re-sent on connect |
| Job completes while disconnected | Snapshot shows `completed` status; SSE closes immediately |
| Server restart | Job state is in PostgreSQL; BullMQ recovers from Redis; client reconnects |

### No-Gap Guarantee

Because the Worker writes to PostgreSQL **before** publishing to Redis Pub/Sub (see `JobEventsService.transition`), the SSE endpoint's snapshot always includes the latest persisted state. Even if a Pub/Sub message is lost during reconnection, the snapshot fills the gap.

---

## Frontend Implementation

### SSE Hook — `apps/web/src/hooks/useJobStream.util.ts`

```ts
import { useState, useEffect, useCallback, useRef } from 'react';

import { useAuth0 } from '@auth0/auth0-react';

import { JobEvent } from '@mcp-ui/core/models';

interface JobState {
  status: string;
  progress: number;
  error: string | null;
  result: Record<string, unknown> | null;
}

interface UseJobStreamOptions {
  jobId: string | null;
  enabled?: boolean;
}

export const useJobStream = ({ jobId, enabled = true }: UseJobStreamOptions) => {
  const { getAccessTokenSilently } = useAuth0();
  const [state, setState] = useState<JobState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(async () => {
    if (!jobId || !enabled) return;

    // Auth: pass token as query param since EventSource doesn't support headers
    const token = await getAccessTokenSilently();
    const url = `/api/jobs/${jobId}/events?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('snapshot', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setState({
        status: data.status,
        progress: data.progress,
        error: data.error,
        result: data.result,
      });
      setIsConnected(true);
    });

    es.addEventListener('update', (e: MessageEvent) => {
      const event: JobEvent = JSON.parse(e.data);
      setState({
        status: event.status,
        progress: event.progress,
        error: event.error ?? null,
        result: event.result ?? null,
      });

      // Close on terminal state
      if (['completed', 'failed', 'cancelled'].includes(event.status)) {
        es.close();
        setIsConnected(false);
      }
    });

    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects; snapshot will re-sync state
    };
  }, [jobId, enabled, getAccessTokenSilently]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { state, isConnected };
};
```

### SSE Authentication

Since the browser `EventSource` API does not support custom headers, authentication for the SSE endpoint uses a **short-lived query parameter token**:

1. The frontend calls `getAccessTokenSilently()` and appends the JWT as `?token=<jwt>`
2. The SSE route extracts the token from `req.query.token` and validates it with the same `jwtCheck` logic
3. Add a dedicated middleware for SSE auth in `apps/api/src/middleware/sse-auth.middleware.ts`:

```ts
import { jwtVerify } from 'express-oauth2-jwt-bearer';
import { environment } from '../environment';

export const sseAuth = async (req, res, next) => {
  const token = req.query.token as string;
  if (!token) return res.status(401).json({ message: 'Missing token' });

  // Rewrite as Authorization header for standard JWT validation
  req.headers.authorization = `Bearer ${token}`;
  return jwtCheck(req, res, next);
};
```

### TanStack Query Integration

For the REST endpoints (list, get), use existing `useAuthQuery`:

```ts
// Fetch job list
const { data: jobs } = useAuthQuery<Job[]>(['jobs'], '/api/jobs');

// Fetch single job + SSE stream
const { data: job } = useAuthQuery<Job>(['jobs', jobId], `/api/jobs/${jobId}`);
const { state } = useJobStream({ jobId });

// Merge: prefer live SSE state, fall back to query data
const currentStatus = state?.status ?? job?.status;
const currentProgress = state?.progress ?? job?.progress;
```

---

## API Error Codes

Add to `apps/api/src/constants/api-codes.constants.ts`:

```ts
// Jobs
JOB_NOT_FOUND = 'JOB_NOT_FOUND',
JOB_ALREADY_TERMINAL = 'JOB_ALREADY_TERMINAL',
JOB_ENQUEUE_FAILED = 'JOB_ENQUEUE_FAILED',
JOB_UNAUTHORIZED = 'JOB_UNAUTHORIZED',
```

---

## Graceful Shutdown

Update `apps/api/src/index.ts` to clean up queue resources:

```ts
import { jobsWorker } from './queues/jobs.worker';
import { jobsQueue } from './queues/jobs.queue';
import { closeRedis } from './utils/redis.util';

const shutdown = async () => {
  logger.info('Shutting down...');
  await jobsWorker.close();   // finish in-progress jobs
  await jobsQueue.close();
  await closeRedis();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

---

## New Dependencies

```bash
# apps/api
npm install bullmq ioredis
```

No new frontend dependencies required — `EventSource` is a browser built-in.

---

## File Manifest

| File | Package | Purpose |
|------|---------|---------|
| `packages/core/src/models/job.model.ts` | core | Zod schema, model class, factory |
| `apps/api/src/db/schema/jobs.table.ts` | api | Drizzle table definition |
| `apps/api/src/db/repositories/jobs.repository.ts` | api | Job CRUD repository |
| `apps/api/src/utils/redis.util.ts` | api | Redis client singleton |
| `apps/api/src/queues/jobs.queue.ts` | api | BullMQ queue instance |
| `apps/api/src/queues/jobs.worker.ts` | api | BullMQ worker + processor registry |
| `apps/api/src/queues/processors/*.processor.ts` | api | Per-type job processors |
| `apps/api/src/services/jobs.service.ts` | api | Job orchestration (create, cancel, list) |
| `apps/api/src/services/job-events.service.ts` | api | State persistence + Redis Pub/Sub |
| `apps/api/src/routes/jobs.router.ts` | api | REST + SSE endpoints |
| `apps/api/src/middleware/sse-auth.middleware.ts` | api | Query-param JWT auth for SSE |
| `apps/web/src/hooks/useJobStream.util.ts` | web | SSE client hook |

---

## Implementation Order

1. **Infrastructure** — Add Redis to docker-compose, create `redis.util.ts`, add `REDIS_URL` to environment
2. **Data model** — `job.model.ts` (core) → `jobs.table.ts` (api) → migration → type-checks
3. **Repository** — `jobs.repository.ts` extending base `Repository`
4. **Queue layer** — `jobs.queue.ts`, `jobs.worker.ts`, processor registry
5. **Event service** — `job-events.service.ts` (Postgres writes + Redis Pub/Sub)
6. **API routes** — `jobs.router.ts` (REST + SSE), `sse-auth.middleware.ts`, mount in protected router
7. **Jobs service** — `jobs.service.ts` orchestration layer
8. **Graceful shutdown** — Update `index.ts` with queue/Redis cleanup
9. **Frontend hook** — `useJobStream.util.ts`
10. **First processor** — Implement one concrete job type end-to-end
11. **UI components** — Job progress indicators, job list view

---

## Implementation Checklist

### Step 1 — Infrastructure
- [x] Add `redis` service to `docker-compose.yml` (Redis 7, port 6379, healthcheck, volume)
- [x] Add `redis-data` volume to `docker-compose.yml`
- [x] Add `REDIS_URL` to `apps/api/src/environment.ts`
- [x] Add `REDIS_URL` to `.env.example` / `.env` files
- [x] Create `apps/api/src/utils/redis.util.ts` (client singleton, `getRedisClient`, `closeRedis`)
- [x] Install dependencies: `npm install bullmq ioredis` in `apps/api/`
- [x] Verify Redis connectivity from API server

### Step 2 — Data Model
- [x] Create `packages/core/src/models/job.model.ts` (`JobStatus`, `JobType` enums, `JobSchema`, `JobModel`, `JobModelFactory`)
- [x] Export from `packages/core/src/models/index.ts`
- [x] Create `apps/api/src/db/schema/jobs.table.ts` (Drizzle table with `baseColumns`)
- [x] Export from `apps/api/src/db/schema/index.ts`
- [x] Add `JobSelectSchema` / `JobInsertSchema` to `apps/api/src/db/schema/zod.ts`
- [x] Add bidirectional `IsAssignable` checks to `apps/api/src/db/schema/type-checks.ts`
- [x] Run `npm run db:generate` to create migration
- [x] Run `npm run db:migrate` to apply migration
- [x] Verify build passes (`npm run type-check`)

### Step 3 — Repository
- [x] Create `apps/api/src/db/repositories/jobs.repository.ts` extending `Repository`
- [x] Add entity-specific methods (`findByStatus`, `findByBullJobId`)
- [x] Export singleton `jobsRepo` instance
- [x] Register in `DbService.repository` object

### Step 4 — Queue Layer
- [x] Create `apps/api/src/queues/jobs.queue.ts` (BullMQ `Queue` instance with default options)
- [x] Create `apps/api/src/queues/jobs.worker.ts` (BullMQ `Worker`, processor registry, event forwarding)
- [x] Create `apps/api/src/queues/processors/` directory
- [x] Create `apps/api/src/queues/processors/index.ts` (registers all processors)
- [x] Initialize worker on API server startup in `apps/api/src/index.ts`
- [x] Create and run integration tests for job related queues, services and processors (`apps/api/src/__tests__/__integration__/queues/`)

### Step 5 — Event Service
- [x] Create `apps/api/src/services/job-events.service.ts`
- [x] Implement `transition()` — update PostgreSQL row + publish to Redis Pub/Sub
- [x] Implement `updateProgress()` — progress-only update + publish
- [x] Implement `subscribe()` — Redis Pub/Sub listener with cleanup function
- [x] Verify write-before-publish ordering for no-gap guarantee

### Step 6 — API Routes
- [x] Create `apps/api/src/middleware/sse-auth.middleware.ts` (query-param JWT validation)
- [x] Create `apps/api/src/routes/jobs.router.ts`
- [x] Implement `POST /api/jobs` — create and enqueue
- [x] Implement `GET /api/jobs` — list with pagination and filters
- [x] Implement `GET /api/jobs/:id` — get single job
- [x] Implement `GET /api/jobs/:id/events` — SSE stream with snapshot-on-connect
- [x] Implement `POST /api/jobs/:id/cancel` — cancel a running job
- [x] Mount `jobsRouter` in `apps/api/src/routes/protected.router.ts`
- [x] Add job error codes to `apps/api/src/constants/api-codes.constants.ts`
- [x] Add request validation middleware for `POST /api/jobs` body

### Step 7 — Jobs Service
- [x] Create `apps/api/src/services/jobs.service.ts`
- [x] Implement `create()` — DB insert + BullMQ enqueue + store `bullJobId`
- [x] Implement `findById()` — with `JOB_NOT_FOUND` error
- [x] Implement `listForOrganization()` — resolve org, query with pagination
- [x] Implement `cancel()` — remove from BullMQ + transition to `cancelled`

### Step 8 — Graceful Shutdown
- [x] Import worker and queue in `apps/api/src/index.ts`
- [x] Add `jobsWorker.close()` to shutdown handler
- [x] Add `jobsQueue.close()` to shutdown handler
- [x] Add `closeRedis()` to shutdown handler
- [x] Verify shutdown order: worker → queue → Redis → database

### Step 9 — Frontend Hook
- [x] Create `apps/web/src/hooks/useJobStream.util.ts`
- [x] Implement `EventSource` connection with Auth0 token as query param
- [x] Handle `snapshot` event — set initial state
- [x] Handle `update` event — merge live state, close on terminal
- [x] Handle `error` event — track connection status, allow auto-reconnect
- [x] Clean up `EventSource` on unmount
- [x] Verify browser refresh recovery (snapshot re-syncs state)

### Step 10 — First Processor
- [ ] Choose initial job type (e.g., `system_check`)
- [ ] Create `apps/api/src/queues/processors/<type>.processor.ts`
- [ ] Implement processor with `bullJob.updateProgress()` calls
- [ ] Register processor in `apps/api/src/queues/processors/index.ts`
- [ ] End-to-end test: create job → watch SSE → verify progress → confirm completion

### Step 11 — UI Components
- [ ] Create job progress bar component (`JobProgress.component.tsx`)
- [ ] Create job status badge component (`JobStatusBadge.component.tsx`)
- [ ] Create jobs list view (`Jobs.view.tsx`) with filtering and pagination
- [ ] Create job detail view (`JobDetail.view.tsx`) with live SSE progress
- [ ] Add route for jobs in `apps/web/src/routes/_authorized/`
- [ ] Add navigation link to jobs in sidebar/header
- [ ] Integrate `useJobStream` hook with TanStack Query fallback
- [ ] Add Storybook stories for job components
