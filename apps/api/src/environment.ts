export const environment = {
  NODE_ENV: process.env.NODE_ENV || "development",
  BUILD_VERSION: process.env.BUILD_VERSION || "dev",
  BUILD_SHA: process.env.BUILD_SHA || "local",
  NAMESPACE: process.env.NAMESPACE,
  PORT: process.env.PORT,
  CORS_ORIGIN: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : [],
  AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  // Logging configuration
  LOG_LEVEL: (process.env.LOG_LEVEL || "info") as
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error"
    | "fatal",
  LOG_FORMAT: (process.env.LOG_FORMAT || "pretty") as "pretty" | "json",
  // Database configuration
  DATABASE_URL: process.env.DATABASE_URL || "",
  // Auth0 webhook
  AUTH0_WEBHOOK_SECRET: process.env.AUTH0_WEBHOOK_SECRET,
  // System ID for deterministic UUID generation
  SYSTEM_ID: process.env.SYSTEM_ID,
  // Anthropic configuration
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  // Tavily configuration
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  // Encryption key for securing sensitive data at rest (base64-encoded, 32 bytes)
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  // Redis configuration (BullMQ + Pub/Sub)
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6380",
  // Size cap for POST /api/file-uploads/parse. Defaults to 25 MB, per the
  // frontend plan §Phase 6.1. Override via env when a customer needs a larger
  // in-memory parse ceiling.
  FILE_UPLOAD_PARSE_MAX_BYTES: parseInt(
    process.env.FILE_UPLOAD_PARSE_MAX_BYTES || String(25 * 1024 * 1024),
    10
  ),
  // Body-parser cap for `express.json()`. Plan-driven endpoints
  // (`/layout-plan/interpret`, `/layout-plan/:planId/commit`) accept the
  // adapted workbook inline as JSON; sparse-cell encoding adds ~30 bytes per
  // populated cell so the JSON payload can run a few× larger than the source
  // file. Default sized to comfortably hold a 25 MB upload after expansion.
  REQUEST_JSON_LIMIT_BYTES: parseInt(
    process.env.REQUEST_JSON_LIMIT_BYTES || String(100 * 1024 * 1024),
    10
  ),
};
