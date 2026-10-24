import { pathToFileURL } from "node:url";

import { closeJobsQueue } from "../queues/jobs.queue.js";
import { JobRedispatchService } from "../services/job-redispatch.service.js";
import { createLogger } from "../utils/logger.util.js";
import { assertRedisReachable } from "../utils/redis.util.js";

const logger = createLogger({ module: "jobs-redispatch" });

/**
 * Job re-dispatch entrypoint (#852). `portalops jobs redispatch` runs it as an
 * ECS one-off (`node dist/scripts/jobs-redispatch.js`) after a Redis
 * replacement, with the API service at zero; locally it is
 * `npm run jobs:redispatch`. `--dry-run` reports without writing.
 *
 * The summary goes to stdout as one JSON line (the task's CloudWatch log is
 * where an operator reads it). Fail-closed like `db-upgrade`: a pass that
 * didn't run because another held the lock is not a success.
 */
// Run only as an entrypoint, never on import.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dryRun = process.argv.includes("--dry-run");
  // Checked first, even when nothing needs re-queuing (#867): the queue's own
  // client retries forever, so a bad endpoint or CA would otherwise hang the
  // task through the maintenance window instead of failing it.
  assertRedisReachable()
    .then(() => JobRedispatchService.redispatchOrphans({ dryRun }))
    .then(async (summary) => {
      process.stdout.write(JSON.stringify(summary) + "\n");
      await closeJobsQueue();
      process.exit(summary.acquiredLock ? 0 : 1);
    })
    .catch((error) => {
      logger.error({ error }, `REDISPATCH FAILED: ${(error as Error).message}`);
      process.exit(1);
    });
}
