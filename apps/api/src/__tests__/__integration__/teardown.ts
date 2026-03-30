/**
 * Global teardown for integration tests.
 *
 * Closes the module-level database connection pool so Jest can exit
 * cleanly without forceExit. The tsx/esm loader is registered via
 * --import in NODE_OPTIONS, enabling .js → .ts resolution here.
 */

import { closeDatabase } from "../../db/client.js";

export default async function globalTeardown() {
  await closeDatabase();
  console.log("✅ Integration tests completed");
}
