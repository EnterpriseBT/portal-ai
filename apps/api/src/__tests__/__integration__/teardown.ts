/**
 * Global teardown for integration tests.
 *
 * The postgres-test container from docker-compose remains running.
 * This just logs completion.
 */

export default async function globalTeardown() {
  console.log("✅ Integration tests completed");
  // The postgres-test container keeps running for subsequent test runs
}
