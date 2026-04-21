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
  // Size cap for the legacy multipart POST /api/file-uploads/parse path.
  // The streaming pipeline (presigned-URL → S3 → server-side stream) does
  // not consult this; see UPLOAD_MAX_FILE_SIZE_BYTES instead.
  FILE_UPLOAD_PARSE_MAX_BYTES: parseInt(
    process.env.FILE_UPLOAD_PARSE_MAX_BYTES || String(25 * 1024 * 1024),
    10
  ),
  // Body-parser cap for `express.json()`. Post-streaming-cutover, no
  // legitimate request body exceeds a few MB (layout plans + region hints).
  REQUEST_JSON_LIMIT_BYTES: parseInt(
    process.env.REQUEST_JSON_LIMIT_BYTES || String(4 * 1024 * 1024),
    10
  ),
  // ── S3 streaming upload pipeline
  //    (see docs/LARGE_WORKBOOK_STREAMING.plan.md §Phase 0).
  UPLOAD_S3_BUCKET: process.env.UPLOAD_S3_BUCKET || "",
  UPLOAD_S3_REGION: process.env.UPLOAD_S3_REGION || "us-east-1",
  UPLOAD_S3_PREFIX: process.env.UPLOAD_S3_PREFIX || "uploads",
  UPLOAD_S3_PRESIGN_EXPIRY_SEC: parseInt(
    process.env.UPLOAD_S3_PRESIGN_EXPIRY_SEC || "600",
    10
  ),
  UPLOAD_MAX_FILES_PER_SESSION: parseInt(
    process.env.UPLOAD_MAX_FILES_PER_SESSION || "25",
    10
  ),
  UPLOAD_MAX_FILE_SIZE_BYTES: parseInt(
    process.env.UPLOAD_MAX_FILE_SIZE_BYTES || String(500 * 1024 * 1024),
    10
  ),
  // Per-sheet cell-count threshold: sheets under it ship inline in the parse
  // response, over it fall back to the lazy slice endpoint.
  FILE_UPLOAD_INLINE_CELLS_MAX: parseInt(
    process.env.FILE_UPLOAD_INLINE_CELLS_MAX || String(1_000_000),
    10
  ),
  // Per-request rectangle cap for GET /api/file-uploads/sheet-slice so a
  // runaway client can't pull the whole sheet in one call.
  FILE_UPLOAD_SLICE_CELLS_MAX: parseInt(
    process.env.FILE_UPLOAD_SLICE_CELLS_MAX || String(50_000),
    10
  ),
  // Redis TTL (seconds) for the parsed-workbook cache keyed by uploadSessionId.
  FILE_UPLOAD_CACHE_TTL_SEC: parseInt(
    process.env.FILE_UPLOAD_CACHE_TTL_SEC || String(60 * 60),
    10
  ),
  UPLOAD_ALLOWED_EXTENSIONS: (
    process.env.UPLOAD_ALLOWED_EXTENSIONS || ".csv,.tsv,.xlsx,.xls"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
