import type { JobProcessor } from "../jobs.worker.js";

/**
 * Declarative processor map.
 *
 * To add a new processor:
 * 1. Create `<type>.processor.ts` in this directory
 * 2. Export the handler function from it
 * 3. Import and add it to the `processors` map below
 */
export const processors: Record<string, JobProcessor> = {
  // Uncomment as processors are implemented (Step 10):
  // "connector-sync": connectorSyncProcessor,
  // "data-import": dataImportProcessor,
  // "report-generation": reportGenerationProcessor,
};
