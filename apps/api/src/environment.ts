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
  // S3 configuration (file uploads)
  UPLOAD_S3_BUCKET: process.env.UPLOAD_S3_BUCKET || "",
  UPLOAD_S3_REGION: process.env.UPLOAD_S3_REGION || "us-east-1",
  UPLOAD_S3_PREFIX: process.env.UPLOAD_S3_PREFIX || "uploads",
  UPLOAD_S3_PRESIGN_EXPIRY_SEC: parseInt(process.env.UPLOAD_S3_PRESIGN_EXPIRY_SEC || "900", 10),
  UPLOAD_MAX_FILE_SIZE_MB: parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || "50", 10),
  UPLOAD_MAX_FILES: parseInt(process.env.UPLOAD_MAX_FILES || "5", 10),
  UPLOAD_ALLOWED_EXTENSIONS: (process.env.UPLOAD_ALLOWED_EXTENSIONS || ".csv,.xlsx").split(","),
};
