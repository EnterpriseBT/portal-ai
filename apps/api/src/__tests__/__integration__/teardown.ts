/**
 * Global teardown for integration tests.
 *
 * Closes the module-level database connection pool so Jest can exit
 * cleanly without forceExit. Uses tsx to register the TypeScript loader
 * since globalTeardown runs outside ts-jest's transform pipeline.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("tsx/esm", pathToFileURL("./"));

export default async function globalTeardown() {
  const { closeDatabase } = await import("../../db/client.js");
  await closeDatabase();
  console.log("✅ Integration tests completed");
}
