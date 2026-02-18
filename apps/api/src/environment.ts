export const environment = {
  NODE_ENV: process.env.NODE_ENV || "development",
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
};
