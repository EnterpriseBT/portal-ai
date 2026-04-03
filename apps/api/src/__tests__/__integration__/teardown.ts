/**
 * Global teardown for integration tests.
 *
 * Jest runs globalTeardown in its own context where ESM module
 * resolution for the app's deep import chains can fail. Instead of
 * importing from the app's db/client (which pulls in environment,
 * logger, schema, etc.), we simply log completion. The test database
 * connections are closed by individual test suites in their afterEach
 * hooks, and forceExit in the Jest config handles any stragglers.
 */

export default async function globalTeardown() {
  console.log("✅ Integration tests completed");
}
