import http from "node:http";

import { createLogger } from "./logger.util.js";

const logger = createLogger({ module: "shutdown" });

export interface ShutdownDeps {
  server: http.Server | undefined;
  closeWorker: () => Promise<void>;
  closeQueue: () => Promise<void>;
  closeRedis: () => Promise<void>;
  closeDatabase: () => Promise<void>;
}

/**
 * Orchestrates graceful shutdown in a deterministic order:
 *   1. HTTP server (stop accepting new requests)
 *   2. Worker (finish in-flight jobs, stop polling)
 *   3. Queue (flush pending commands)
 *   4. Redis (close shared connection)
 *   5. Database (close pool)
 */
export async function gracefulShutdown(deps: ShutdownDeps): Promise<void> {
  logger.info("Shutting down…");

  // 1. Stop HTTP server
  if (deps.server) {
    await new Promise<void>((resolve, reject) => {
      deps.server!.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // 2. Worker → 3. Queue → 4. Redis → 5. Database
  await deps.closeWorker();
  await deps.closeQueue();
  await deps.closeRedis();
  await deps.closeDatabase();

  logger.info("Shutdown complete");
}
