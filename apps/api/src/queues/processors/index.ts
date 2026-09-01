import type { JobProcessor } from "../jobs.worker.js";
import { systemCheckProcessor } from "./system-check.processor.js";
import { revalidationProcessor } from "./revalidation.processor.js";
import { entityRecordClearProcessor } from "./entity-record-clear.processor.js";
import { connectorSyncProcessor } from "./connector-sync.processor.js";
import { fileUploadParseProcessor } from "./file-upload-parse.processor.js";
import { layoutPlanCommitProcessor } from "./layout-plan-commit.processor.js";
import { bulkTransformProcessor } from "./bulk-transform.processor.js";
import { bulkGeocodeProcessor } from "./bulk-geocode.processor.js";
import { sqlQueryProcessor } from "./sql-query.processor.js";
import { dissolvePrecomputeProcessor } from "./dissolve-precompute.processor.js";

/**
 * Declarative processor map.
 *
 * To add a new processor:
 * 1. Create `<type>.processor.ts` in this directory
 * 2. Export the handler function from it
 * 3. Import and add it to the `processors` map below
 */
export const processors: Record<string, JobProcessor> = {
  system_check: systemCheckProcessor,
  revalidation: revalidationProcessor,
  entity_record_clear: entityRecordClearProcessor,
  connector_sync: connectorSyncProcessor,
  file_upload_parse: fileUploadParseProcessor,
  layout_plan_commit: layoutPlanCommitProcessor,
  bulk_transform: bulkTransformProcessor,
  bulk_geocode: bulkGeocodeProcessor,
  sql_query: sqlQueryProcessor,
  dissolve_precompute: dissolvePrecomputeProcessor,
};
