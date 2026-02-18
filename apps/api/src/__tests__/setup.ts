/**
 * Jest test setup for the API app.
 *
 * - Sets test environment variables
 * - Silences pino loggers during tests
 */

// Set environment variables before any module imports
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.AUTH0_DOMAIN = "test.auth0.com";
process.env.AUTH0_AUDIENCE = "https://test-api";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgresql://localhost:5432/test";
process.env.NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
process.env.AUTH0_WEBHOOK_SECRET = "test-webhook-secret";
process.env.SYSTEM_ID = "SYSTEM_ID_TEST";
