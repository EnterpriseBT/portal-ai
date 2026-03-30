/**
 * Global teardown for integration tests.
 *
 * Closes the module-level database connection pool so Jest can exit
 * cleanly without forceExit.
 */

import { closeDatabase } from "../../db/client.js";

export default async function globalTeardown() {
  await closeDatabase();
  console.log("✅ Integration tests completed");
}
