export enum ApiCode {
  // Profile
  PROFILE_MISSING_TOKEN = "PROFILE_MISSING_TOKEN",
  PROFILE_FETCH_FAILED = "PROFILE_FETCH_FAILED",
  PROFILE_INVALID_RESPONSE = "PROFILE_INVALID_RESPONSE",
  PROFILE_USER_NOT_FOUND = "PROFILE_USER_NOT_FOUND",

  // Auth
  AUTH_UPSTREAM_ERROR = "AUTH_UPSTREAM_ERROR",

  // Request lifecycle
  REQUEST_PAYLOAD_TOO_LARGE = "REQUEST_PAYLOAD_TOO_LARGE",
  REQUEST_BODY_INVALID_JSON = "REQUEST_BODY_INVALID_JSON",

  // Health
  HEALTH_CHECK_FAILED = "HEALTH_CHECK_FAILED",

  // Organization
  ORGANIZATION_USER_NOT_FOUND = "ORGANIZATION_USER_NOT_FOUND",
  ORGANIZATION_NOT_FOUND = "ORGANIZATION_NOT_FOUND",
  ORGANIZATION_FETCH_FAILED = "ORGANIZATION_FETCH_FAILED",

  // Webhooks
  WEBHOOK_MISSING_SIGNATURE = "WEBHOOK_MISSING_SIGNATURE",
  WEBHOOK_INVALID_SIGNATURE = "WEBHOOK_INVALID_SIGNATURE",
  WEBHOOK_INVALID_PAYLOAD = "WEBHOOK_INVALID_PAYLOAD",
  WEBHOOK_SYNC_FAILED = "WEBHOOK_SYNC_FAILED",
  WEBHOOK_MISSING_SECRET = "WEBHOOK_MISSING_SECRET",

  // Connector Definitions
  CONNECTOR_DEFINITION_NOT_FOUND = "CONNECTOR_DEFINITION_NOT_FOUND",
  CONNECTOR_DEFINITION_FETCH_FAILED = "CONNECTOR_DEFINITION_FETCH_FAILED",

  // Connector Instances
  CONNECTOR_INSTANCE_NOT_FOUND = "CONNECTOR_INSTANCE_NOT_FOUND",
  CONNECTOR_INSTANCE_FETCH_FAILED = "CONNECTOR_INSTANCE_FETCH_FAILED",
  CONNECTOR_INSTANCE_INVALID_PAYLOAD = "CONNECTOR_INSTANCE_INVALID_PAYLOAD",
  CONNECTOR_INSTANCE_CREATE_FAILED = "CONNECTOR_INSTANCE_CREATE_FAILED",
  CONNECTOR_INSTANCE_USER_NOT_FOUND = "CONNECTOR_INSTANCE_USER_NOT_FOUND",
  CONNECTOR_INSTANCE_DELETE_FAILED = "CONNECTOR_INSTANCE_DELETE_FAILED",
  CONNECTOR_INSTANCE_UPDATE_FAILED = "CONNECTOR_INSTANCE_UPDATE_FAILED",
  CONNECTOR_INSTANCE_WRITE_DISABLED = "CONNECTOR_INSTANCE_WRITE_DISABLED",
  CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED = "CONNECTOR_INSTANCE_CAPABILITY_NOT_SUPPORTED",

  // Session
  SESSION_PROMPT_INVALID = "SESSION_PROMPT_INVALID",
  SESSION_STREAM_FAILED = "SESSION_STREAM_FAILED",
  SESSION_USER_NOT_FOUND = "SESSION_USER_NOT_FOUND",

  // Jobs
  JOB_NOT_FOUND = "JOB_NOT_FOUND",
  JOB_ALREADY_TERMINAL = "JOB_ALREADY_TERMINAL",
  JOB_ENQUEUE_FAILED = "JOB_ENQUEUE_FAILED",
  JOB_UNAUTHORIZED = "JOB_UNAUTHORIZED",
  JOB_INVALID_PAYLOAD = "JOB_INVALID_PAYLOAD",
  JOB_FETCH_FAILED = "JOB_FETCH_FAILED",
  JOB_CANCEL_FAILED = "JOB_CANCEL_FAILED",
  JOB_SUBSCRIBE_FAILED = "JOB_SUBSCRIBE_FAILED",
  JOB_USER_NOT_FOUND = "JOB_USER_NOT_FOUND",
  /**
   * Returned (409) when a mutation targets an entity that has a
   * non-terminal job in flight against it. The route surfaces the
   * blocking job ids + types in `details.runningJobs` so the client
   * can show which background work the user is racing.
   */
  ENTITY_LOCKED_BY_JOB = "ENTITY_LOCKED_BY_JOB",

  // Column Definitions
  COLUMN_DEFINITION_NOT_FOUND = "COLUMN_DEFINITION_NOT_FOUND",
  COLUMN_DEFINITION_FETCH_FAILED = "COLUMN_DEFINITION_FETCH_FAILED",
  COLUMN_DEFINITION_INVALID_PAYLOAD = "COLUMN_DEFINITION_INVALID_PAYLOAD",
  COLUMN_DEFINITION_CREATE_FAILED = "COLUMN_DEFINITION_CREATE_FAILED",
  COLUMN_DEFINITION_UPDATE_FAILED = "COLUMN_DEFINITION_UPDATE_FAILED",
  COLUMN_DEFINITION_DELETE_FAILED = "COLUMN_DEFINITION_DELETE_FAILED",
  COLUMN_DEFINITION_USER_NOT_FOUND = "COLUMN_DEFINITION_USER_NOT_FOUND",
  COLUMN_DEFINITION_HAS_DEPENDENCIES = "COLUMN_DEFINITION_HAS_DEPENDENCIES",
  COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED = "COLUMN_DEFINITION_TYPE_CHANGE_BLOCKED",
  COLUMN_DEFINITION_KEY_IMMUTABLE = "COLUMN_DEFINITION_KEY_IMMUTABLE",
  COLUMN_DEFINITION_SYSTEM_READONLY = "COLUMN_DEFINITION_SYSTEM_READONLY",
  COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN = "COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN",

  // Connector Entities
  CONNECTOR_ENTITY_NOT_FOUND = "CONNECTOR_ENTITY_NOT_FOUND",
  CONNECTOR_ENTITY_FETCH_FAILED = "CONNECTOR_ENTITY_FETCH_FAILED",
  CONNECTOR_ENTITY_INVALID_PAYLOAD = "CONNECTOR_ENTITY_INVALID_PAYLOAD",
  CONNECTOR_ENTITY_CREATE_FAILED = "CONNECTOR_ENTITY_CREATE_FAILED",
  CONNECTOR_ENTITY_DELETE_FAILED = "CONNECTOR_ENTITY_DELETE_FAILED",
  CONNECTOR_ENTITY_UPDATE_FAILED = "CONNECTOR_ENTITY_UPDATE_FAILED",
  CONNECTOR_ENTITY_USER_NOT_FOUND = "CONNECTOR_ENTITY_USER_NOT_FOUND",
  CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR = "CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR",
  ENTITY_HAS_EXTERNAL_REFERENCES = "ENTITY_HAS_EXTERNAL_REFERENCES",

  // Field Mappings
  FIELD_MAPPING_NOT_FOUND = "FIELD_MAPPING_NOT_FOUND",
  FIELD_MAPPING_FETCH_FAILED = "FIELD_MAPPING_FETCH_FAILED",
  FIELD_MAPPING_INVALID_PAYLOAD = "FIELD_MAPPING_INVALID_PAYLOAD",
  FIELD_MAPPING_CREATE_FAILED = "FIELD_MAPPING_CREATE_FAILED",
  FIELD_MAPPING_DUPLICATE_COLUMN = "FIELD_MAPPING_DUPLICATE_COLUMN",
  FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY = "FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY",
  FIELD_MAPPING_INVALID_NORMALIZED_KEY = "FIELD_MAPPING_INVALID_NORMALIZED_KEY",
  FIELD_MAPPING_INVALID_ENUM_VALUES = "FIELD_MAPPING_INVALID_ENUM_VALUES",
  FIELD_MAPPING_INVALID_FORMAT = "FIELD_MAPPING_INVALID_FORMAT",
  FIELD_MAPPING_UPDATE_FAILED = "FIELD_MAPPING_UPDATE_FAILED",
  FIELD_MAPPING_DELETE_FAILED = "FIELD_MAPPING_DELETE_FAILED",
  FIELD_MAPPING_DELETE_HAS_RECORDS = "FIELD_MAPPING_DELETE_HAS_RECORDS",
  FIELD_MAPPING_USER_NOT_FOUND = "FIELD_MAPPING_USER_NOT_FOUND",
  FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED = "FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED",
  FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND = "FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND",

  // Revalidation
  REVALIDATION_ACTIVE = "REVALIDATION_ACTIVE",
  REVALIDATION_ENQUEUE_FAILED = "REVALIDATION_ENQUEUE_FAILED",

  // Entity Records
  ENTITY_RECORD_NOT_FOUND = "ENTITY_RECORD_NOT_FOUND",
  ENTITY_RECORD_FETCH_FAILED = "ENTITY_RECORD_FETCH_FAILED",
  ENTITY_RECORD_IMPORT_FAILED = "ENTITY_RECORD_IMPORT_FAILED",
  ENTITY_RECORD_INVALID_PAYLOAD = "ENTITY_RECORD_INVALID_PAYLOAD",
  ENTITY_RECORD_INVALID_FILTER = "ENTITY_RECORD_INVALID_FILTER",
  ENTITY_RECORD_DELETE_FAILED = "ENTITY_RECORD_DELETE_FAILED",
  ENTITY_RECORD_UPDATE_FAILED = "ENTITY_RECORD_UPDATE_FAILED",
  ENTITY_RECORD_CREATE_FAILED = "ENTITY_RECORD_CREATE_FAILED",

  // Entity Tags
  ENTITY_TAG_NOT_FOUND = "ENTITY_TAG_NOT_FOUND",
  ENTITY_TAG_FETCH_FAILED = "ENTITY_TAG_FETCH_FAILED",
  ENTITY_TAG_INVALID_PAYLOAD = "ENTITY_TAG_INVALID_PAYLOAD",
  ENTITY_TAG_CREATE_FAILED = "ENTITY_TAG_CREATE_FAILED",
  ENTITY_TAG_UPDATE_FAILED = "ENTITY_TAG_UPDATE_FAILED",
  ENTITY_TAG_DELETE_FAILED = "ENTITY_TAG_DELETE_FAILED",
  ENTITY_TAG_DUPLICATE_NAME = "ENTITY_TAG_DUPLICATE_NAME",
  ENTITY_TAG_USER_NOT_FOUND = "ENTITY_TAG_USER_NOT_FOUND",

  // Entity Tag Assignments
  ENTITY_TAG_ASSIGNMENT_NOT_FOUND = "ENTITY_TAG_ASSIGNMENT_NOT_FOUND",
  ENTITY_TAG_ASSIGNMENT_FETCH_FAILED = "ENTITY_TAG_ASSIGNMENT_FETCH_FAILED",
  ENTITY_TAG_ASSIGNMENT_CREATE_FAILED = "ENTITY_TAG_ASSIGNMENT_CREATE_FAILED",
  ENTITY_TAG_ASSIGNMENT_DELETE_FAILED = "ENTITY_TAG_ASSIGNMENT_DELETE_FAILED",
  ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS = "ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS",

  // Entity Groups
  ENTITY_GROUP_NOT_FOUND = "ENTITY_GROUP_NOT_FOUND",
  ENTITY_GROUP_FETCH_FAILED = "ENTITY_GROUP_FETCH_FAILED",
  ENTITY_GROUP_INVALID_PAYLOAD = "ENTITY_GROUP_INVALID_PAYLOAD",
  ENTITY_GROUP_CREATE_FAILED = "ENTITY_GROUP_CREATE_FAILED",
  ENTITY_GROUP_UPDATE_FAILED = "ENTITY_GROUP_UPDATE_FAILED",
  ENTITY_GROUP_DELETE_FAILED = "ENTITY_GROUP_DELETE_FAILED",
  ENTITY_GROUP_DUPLICATE_NAME = "ENTITY_GROUP_DUPLICATE_NAME",
  ENTITY_GROUP_USER_NOT_FOUND = "ENTITY_GROUP_USER_NOT_FOUND",

  // Entity Group Members
  ENTITY_GROUP_MEMBER_NOT_FOUND = "ENTITY_GROUP_MEMBER_NOT_FOUND",
  ENTITY_GROUP_MEMBER_FETCH_FAILED = "ENTITY_GROUP_MEMBER_FETCH_FAILED",
  ENTITY_GROUP_MEMBER_CREATE_FAILED = "ENTITY_GROUP_MEMBER_CREATE_FAILED",
  ENTITY_GROUP_MEMBER_UPDATE_FAILED = "ENTITY_GROUP_MEMBER_UPDATE_FAILED",
  ENTITY_GROUP_MEMBER_DELETE_FAILED = "ENTITY_GROUP_MEMBER_DELETE_FAILED",
  ENTITY_GROUP_MEMBER_ALREADY_EXISTS = "ENTITY_GROUP_MEMBER_ALREADY_EXISTS",
  ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID = "ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID",
  ENTITY_GROUP_MEMBER_PRIMARY_CONFLICT = "ENTITY_GROUP_MEMBER_PRIMARY_CONFLICT",

  // Metadata
  METADATA_MISSING_AUTH = "METADATA_MISSING_AUTH",
  METADATA_USER_NOT_FOUND = "METADATA_USER_NOT_FOUND",
  METADATA_ORGANIZATION_NOT_FOUND = "METADATA_ORGANIZATION_NOT_FOUND",
  METADATA_FETCH_FAILED = "METADATA_FETCH_FAILED",

  // Stations
  STATION_NOT_FOUND = "STATION_NOT_FOUND",
  STATION_SCOPE_VIOLATION = "STATION_SCOPE_VIOLATION",

  // Portals
  PORTAL_NOT_FOUND = "PORTAL_NOT_FOUND",
  PORTAL_RESULT_NOT_FOUND = "PORTAL_RESULT_NOT_FOUND",
  PORTAL_INVALID_STATION = "PORTAL_INVALID_STATION",
  PORTAL_STATION_NO_TOOLS = "PORTAL_STATION_NO_TOOLS",
  PORTAL_STREAM_FAILED = "PORTAL_STREAM_FAILED",

  // Toolpacks
  TOOLPACK_NOT_FOUND = "TOOLPACK_NOT_FOUND",
  STATION_INVALID_TOOLPACK = "STATION_INVALID_TOOLPACK",
  TOOLPACK_INVALID_PAYLOAD = "TOOLPACK_INVALID_PAYLOAD",
  TOOLPACK_NAME_CONFLICT = "TOOLPACK_NAME_CONFLICT",
  TOOLPACK_TOOL_NAME_CONFLICT = "TOOLPACK_TOOL_NAME_CONFLICT",
  TOOLPACK_SCHEMA_FETCH_FAILED = "TOOLPACK_SCHEMA_FETCH_FAILED",
  TOOLPACK_SCHEMA_TOO_LARGE = "TOOLPACK_SCHEMA_TOO_LARGE",
  TOOLPACK_SCHEMA_INVALID = "TOOLPACK_SCHEMA_INVALID",
  TOOLPACK_CAPABILITY_INVALID = "TOOLPACK_CAPABILITY_INVALID",
  TOOLPACK_URL_NOT_HTTPS = "TOOLPACK_URL_NOT_HTTPS",
  TOOLPACK_URL_PRIVATE_HOST = "TOOLPACK_URL_PRIVATE_HOST",
  TOOLPACK_RUNTIME_TOO_LARGE = "TOOLPACK_RUNTIME_TOO_LARGE",
  TOOLPACK_RUNTIME_INVALID = "TOOLPACK_RUNTIME_INVALID",
  TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED = "TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED",

  // Layout Plans (connector_instance_layout_plans)
  LAYOUT_PLAN_INVALID_PAYLOAD = "LAYOUT_PLAN_INVALID_PAYLOAD",
  LAYOUT_PLAN_NOT_FOUND = "LAYOUT_PLAN_NOT_FOUND",
  LAYOUT_PLAN_INTERPRET_FAILED = "LAYOUT_PLAN_INTERPRET_FAILED",
  LAYOUT_PLAN_EDIT_AFTER_COMMIT = "LAYOUT_PLAN_EDIT_AFTER_COMMIT",
  LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND = "LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND",
  LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED = "LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED",
  LAYOUT_PLAN_DRIFT_BLOCKER = "LAYOUT_PLAN_DRIFT_BLOCKER",
  LAYOUT_PLAN_DRIFT_HALT = "LAYOUT_PLAN_DRIFT_HALT",
  LAYOUT_PLAN_COMMIT_FAILED = "LAYOUT_PLAN_COMMIT_FAILED",
  LAYOUT_PLAN_BLOCKER_WARNINGS = "LAYOUT_PLAN_BLOCKER_WARNINGS",
  LAYOUT_PLAN_INVALID_REFERENCE = "LAYOUT_PLAN_INVALID_REFERENCE",
  LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY = "LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY",
  LAYOUT_PLAN_DUPLICATE_ENTITY = "LAYOUT_PLAN_DUPLICATE_ENTITY",

  // File upload parse endpoint
  FILE_UPLOAD_PARSE_INVALID_PAYLOAD = "FILE_UPLOAD_PARSE_INVALID_PAYLOAD",
  FILE_UPLOAD_PARSE_EMPTY = "FILE_UPLOAD_PARSE_EMPTY",
  FILE_UPLOAD_PARSE_UNSUPPORTED = "FILE_UPLOAD_PARSE_UNSUPPORTED",
  FILE_UPLOAD_PARSE_TOO_LARGE = "FILE_UPLOAD_PARSE_TOO_LARGE",
  FILE_UPLOAD_PARSE_FAILED = "FILE_UPLOAD_PARSE_FAILED",

  // Streaming upload pipeline
  FILE_UPLOAD_NOT_FOUND = "FILE_UPLOAD_NOT_FOUND",
  FILE_UPLOAD_FORBIDDEN = "FILE_UPLOAD_FORBIDDEN",
  FILE_UPLOAD_INVALID_STATE = "FILE_UPLOAD_INVALID_STATE",
  FILE_UPLOAD_S3_NOT_PRESENT = "FILE_UPLOAD_S3_NOT_PRESENT",
  FILE_UPLOAD_TOO_MANY_FILES = "FILE_UPLOAD_TOO_MANY_FILES",
  FILE_UPLOAD_SESSION_NOT_FOUND = "FILE_UPLOAD_SESSION_NOT_FOUND",
  FILE_UPLOAD_SLICE_OUT_OF_BOUNDS = "FILE_UPLOAD_SLICE_OUT_OF_BOUNDS",
  FILE_UPLOAD_SLICE_TOO_LARGE = "FILE_UPLOAD_SLICE_TOO_LARGE",
  FILE_UPLOAD_S3_CONFIG_MISSING = "FILE_UPLOAD_S3_CONFIG_MISSING",

  // Google OAuth (google-sheets connector)
  GOOGLE_OAUTH_NOT_CONFIGURED = "GOOGLE_OAUTH_NOT_CONFIGURED",
  GOOGLE_OAUTH_AUTHORIZE_FAILED = "GOOGLE_OAUTH_AUTHORIZE_FAILED",
  GOOGLE_OAUTH_INVALID_STATE = "GOOGLE_OAUTH_INVALID_STATE",
  GOOGLE_OAUTH_EXCHANGE_FAILED = "GOOGLE_OAUTH_EXCHANGE_FAILED",
  GOOGLE_OAUTH_USERINFO_FAILED = "GOOGLE_OAUTH_USERINFO_FAILED",
  GOOGLE_OAUTH_DEFINITION_NOT_FOUND = "GOOGLE_OAUTH_DEFINITION_NOT_FOUND",
  GOOGLE_OAUTH_REFRESH_FAILED = "GOOGLE_OAUTH_REFRESH_FAILED",

  // Google Sheets connector data ops
  GOOGLE_SHEETS_INVALID_INSTANCE_ID = "GOOGLE_SHEETS_INVALID_INSTANCE_ID",
  GOOGLE_SHEETS_LIST_FAILED = "GOOGLE_SHEETS_LIST_FAILED",
  GOOGLE_SHEETS_FETCH_FAILED = "GOOGLE_SHEETS_FETCH_FAILED",
  GOOGLE_SHEETS_INVALID_PAYLOAD = "GOOGLE_SHEETS_INVALID_PAYLOAD",

  // Microsoft OAuth (microsoft-excel connector)
  MICROSOFT_OAUTH_NOT_CONFIGURED = "MICROSOFT_OAUTH_NOT_CONFIGURED",
  MICROSOFT_OAUTH_AUTHORIZE_FAILED = "MICROSOFT_OAUTH_AUTHORIZE_FAILED",
  MICROSOFT_OAUTH_INVALID_STATE = "MICROSOFT_OAUTH_INVALID_STATE",
  MICROSOFT_OAUTH_EXCHANGE_FAILED = "MICROSOFT_OAUTH_EXCHANGE_FAILED",
  MICROSOFT_OAUTH_NO_REFRESH_TOKEN = "MICROSOFT_OAUTH_NO_REFRESH_TOKEN",
  MICROSOFT_OAUTH_USERINFO_FAILED = "MICROSOFT_OAUTH_USERINFO_FAILED",
  MICROSOFT_OAUTH_DEFINITION_NOT_FOUND = "MICROSOFT_OAUTH_DEFINITION_NOT_FOUND",
  MICROSOFT_OAUTH_REFRESH_FAILED = "MICROSOFT_OAUTH_REFRESH_FAILED",
  /**
   * Surfaced when an `invalid_grant` from refresh appears to be a
   * rotation race (another process already rotated the refresh token).
   * The cache layer attempts a single retry against the freshly-read
   * token; this code distinguishes "we tried to recover" from a
   * first-time `MICROSOFT_OAUTH_REFRESH_FAILED`.
   */
  MICROSOFT_OAUTH_REFRESH_TOKEN_RACE = "MICROSOFT_OAUTH_REFRESH_TOKEN_RACE",

  // Microsoft Excel connector data ops
  MICROSOFT_EXCEL_INVALID_INSTANCE_ID = "MICROSOFT_EXCEL_INVALID_INSTANCE_ID",
  MICROSOFT_EXCEL_LIST_FAILED = "MICROSOFT_EXCEL_LIST_FAILED",
  MICROSOFT_EXCEL_FETCH_FAILED = "MICROSOFT_EXCEL_FETCH_FAILED",
  MICROSOFT_EXCEL_INVALID_PAYLOAD = "MICROSOFT_EXCEL_INVALID_PAYLOAD",
  MICROSOFT_EXCEL_FILE_TOO_LARGE = "MICROSOFT_EXCEL_FILE_TOO_LARGE",
  MICROSOFT_EXCEL_UNSUPPORTED_FORMAT = "MICROSOFT_EXCEL_UNSUPPORTED_FORMAT",

  // Sync (Phase D)
  /**
   * @deprecated as of `RECORD_IDENTITY_REVIEW.spec.md` Phase B. The
   * gsheets adapter no longer emits this code — `rowPosition` identity
   * is now an advisory (`identityWarnings`), not a hard refusal. Kept in
   * the enum for backward compatibility with consumers that match on the
   * string.
   */
  LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY = "LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY",
  SYNC_ALREADY_RUNNING = "SYNC_ALREADY_RUNNING",
  /** Connector type does not implement `syncInstance` (file-upload, sandbox, etc.). */
  SYNC_NOT_SUPPORTED = "SYNC_NOT_SUPPORTED",

  // Wide-table reconciler
  /**
   * The reconciler detected that a `field_mapping`'s column-definition type
   * differs from the type already applied to its wide-table column. Phase 1
   * refuses these; phase 5 introduces the staged add-new → backfill → swap
   * → retire flow.
   */
  WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED = "WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED",
  /** The reconciler raised any non-type-change error while applying DDL. */
  WIDE_TABLE_RECONCILE_FAILED = "WIDE_TABLE_RECONCILE_FAILED",
  /** Logged-only — boot drift check failed and the app refuses to start. */
  WIDE_TABLE_DRIFT_AT_BOOT = "WIDE_TABLE_DRIFT_AT_BOOT",

  // Admin / re-sync trigger
  /** A wide-table resync trigger failed to fan out to one or more instances. */
  WIDE_TABLE_RESYNC_FAILED = "WIDE_TABLE_RESYNC_FAILED",

  // Portal SQL surface (Phase 3)
  /** The LLM-supplied SQL hit the deny-list or other safety guard. */
  PORTAL_SQL_FORBIDDEN = "PORTAL_SQL_FORBIDDEN",
  /** Postgres' `statement_timeout` fired on a portal sql_query. */
  PORTAL_SQL_TIMEOUT = "PORTAL_SQL_TIMEOUT",

  // sql_query job-tier escalation (#130 E1b)
  /** The query is long/expensive (EXPLAIN cost over threshold, or it hit the
   *  30s synchronous backstop) and must run as an async job; the agent didn't
   *  set `acknowledgeCost: true`. Mirrors the bulk cost-ack gate. 400. */
  SQL_QUERY_COST_NOT_ACKNOWLEDGED = "SQL_QUERY_COST_NOT_ACKNOWLEDGED",
  /** `acknowledgeCost: true` was set but server-side enforcement rejected —
   *  either no prior escalation exists for this portal+query, or the user
   *  hasn't replied since (the agent retried in the same turn). 400. */
  SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID = "SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID",
  /** The escalated sql_query job was cancelled before it finished. 409. */
  SQL_QUERY_JOB_CANCELLED = "SQL_QUERY_JOB_CANCELLED",
  /** The escalated sql_query job failed off-thread; see `error`. 400. */
  SQL_QUERY_JOB_FAILED = "SQL_QUERY_JOB_FAILED",

  // REST API Connector (Phase 1)
  /** Network error, DNS failure, timeout, or non-2xx response during a probe / sync fetch. */
  REST_API_FETCH_FAILED = "REST_API_FETCH_FAILED",
  /** Response body isn't valid JSON. */
  REST_API_INVALID_JSON = "REST_API_INVALID_JSON",
  /** Walking `recordsPath` returned `undefined`. */
  REST_API_RECORDS_PATH_NOT_FOUND = "REST_API_RECORDS_PATH_NOT_FOUND",
  /** Walking `recordsPath` returned a non-array value. */
  REST_API_RECORDS_PATH_NOT_ARRAY = "REST_API_RECORDS_PATH_NOT_ARRAY",
  /** Endpoint route lookup miss (entity not configured on this instance). */
  REST_API_ENDPOINT_NOT_FOUND = "REST_API_ENDPOINT_NOT_FOUND",
  /** `assertSyncEligibility` short-circuit — instance has no endpoints. */
  REST_API_NO_ENDPOINTS_CONFIGURED = "REST_API_NO_ENDPOINTS_CONFIGURED",
  /** Zod validation failure on endpoint config payload. */
  REST_API_INVALID_CONFIG = "REST_API_INVALID_CONFIG",
  /**
   * Response body exceeded `MAX_RESPONSE_BYTES` (default 500 MB) on the
   * buffered fetch path — used by JSONata transform + Preview / probe.
   * Streaming-eligible syncs (`recordsPath` + `pagination: "none"`) don't
   * hit this; they parse incrementally via `streamFetchRecords`.
   */
  REST_API_RESPONSE_TOO_LARGE = "REST_API_RESPONSE_TOO_LARGE",
  /**
   * The streaming parser emitted a single record whose serialized JSON
   * exceeded `maxRecordBytes` (default 50 MB). Almost always means
   * `recordsPath` is pointing at a non-array node or the document root.
   */
  REST_API_RECORD_TOO_LARGE = "REST_API_RECORD_TOO_LARGE",
  /**
   * Caller tried to iterate a `recordsStream` more than once. Programmer
   * error — the underlying `ReadableStream` is single-use; `fetchJson` is
   * the right primitive for callers that need a snapshot.
   */
  REST_API_STREAM_ALREADY_CONSUMED = "REST_API_STREAM_ALREADY_CONSUMED",
  /** Unhandled error in the rest-api endpoints router — 500 fallback. */
  REST_API_OPERATION_FAILED = "REST_API_OPERATION_FAILED",
  /**
   * JSONata transform failed to parse or threw at runtime. Carried on
   * ApiError.details as `{ kind: "parse" | "runtime", message: string }`.
   * In probe context the pipeline catches this and returns a result with
   * `degradation: "transform-failed"` + `transformError`. In sync context
   * the error propagates as a normal adapter failure.
   */
  REST_API_TRANSFORM_FAILED = "REST_API_TRANSFORM_FAILED",
  /**
   * Haiku-backed JSONata transform suggester failed irrecoverably —
   * model timeout, network error, or a response that didn't conform to
   * the `{ expression: string }` schema. Mapped to HTTP 502 on the
   * `/api/connector-instances/suggest-transform` route. The
   * `JsonataSuggestError.reason` discriminator (timeout /
   * network-error / malformed-response) goes on the structured log
   * line, not the response body.
   *
   * Distinct from validation-warning paths: when the model returns an
   * expression that fails server-side validation against the sample
   * response, the route still returns 200 with a `warning` field —
   * only model failures surface this error code.
   */
  REST_API_TRANSFORM_SUGGEST_FAILED = "REST_API_TRANSFORM_SUGGEST_FAILED",
  /**
   * Authentication failure during sync, test-connection, or auth application:
   *   - 401/403 response from upstream (502, raised by the adapter when
   *     fetchJson reports an auth-bearing status).
   *   - `config.auth.mode` and `credentials.mode` disagree (500 — the
   *     instance is internally inconsistent; surfaced with
   *     `details.mismatch: { configMode, credentialsMode }`).
   *   - Credentials missing for a non-`none` mode at apply-time (500 —
   *     surfaced with `details.reason: "missing"`).
   */
  REST_API_AUTH_FAILED = "REST_API_AUTH_FAILED",
  /**
   * `assertSyncEligibility` rejects a sync when the instance's
   * `config.auth.mode` is non-`none` but credentials are missing,
   * empty, or fail Zod parsing. Surfaced as 409 from the eligibility
   * gate (route layer), not from the adapter itself.
   */
  REST_API_MISSING_CREDENTIALS = "REST_API_MISSING_CREDENTIALS",
  /**
   * Shared `POST /api/connector-instances/:id/test-connection` route
   * resolved an adapter that doesn't implement `testConnection`. 404
   * — lives outside the `REST_API_*` namespace because it's a generic
   * route concern that any adapter can opt into.
   */
  TEST_CONNECTION_NOT_SUPPORTED = "TEST_CONNECTION_NOT_SUPPORTED",
  /**
   * A header / queryParam / bodyTemplate string references a `{{name}}`
   * placeholder outside the closed set ({cursor, pageNumber}). Fired
   * by `applyTemplate` at sync/test-connection time and by the
   * frontend lint at save time. Closed-set substitution is what
   * makes templating safe to ship without a sandbox.
   */
  REST_API_TEMPLATE_UNKNOWN_VARIABLE = "REST_API_TEMPLATE_UNKNOWN_VARIABLE",
  /**
   * Upstream returned 429 and `withRetry` exhausted its budget.
   * Surfaced as 502 with `details.lastRetryAfter` (the final
   * Retry-After header value, if any) + `details.attempts` so the UI
   * can tell users "the upstream API is rate-limiting us, slow down".
   */
  REST_API_RATE_LIMITED = "REST_API_RATE_LIMITED",
  /**
   * A pagination iterator yielded more than `MAX_PAGES` pages without
   * terminating — likely a misbehaving upstream that never returns
   * an empty array / null cursor. Safety cap to prevent runaway
   * fetches. 502.
   */
  REST_API_PAGINATION_EXCEEDED = "REST_API_PAGINATION_EXCEEDED",
  /**
   * The cursor strategy's `cursorResponsePath` doesn't exist on the
   * first page's response body. On subsequent pages the missing path
   * is interpreted as a termination signal; only the first page
   * treats the absence as a configuration error. 502.
   */
  REST_API_CURSOR_NOT_FOUND = "REST_API_CURSOR_NOT_FOUND",
  /**
   * `linkBody` pagination — the configured `nextUrlPath` doesn't
   * resolve on the first page's response body. Subsequent pages treat
   * the missing path as a termination signal (upstream signaling
   * end-of-list); the first-page case is a config error. 502.
   */
  REST_API_NEXT_URL_NOT_FOUND = "REST_API_NEXT_URL_NOT_FOUND",
  /**
   * `linkBody` pagination — the path resolved but the value isn't a
   * string. Common cause: upstream changed schema and the response
   * shape no longer matches the configured path. 502.
   */
  REST_API_NEXT_URL_INVALID = "REST_API_NEXT_URL_INVALID",
  /**
   * Pagination config is malformed (e.g. a cursor strategy with an
   * empty `cursorResponsePath`). Surfaced by the route's validation
   * pre-flight. 400.
   */
  REST_API_PAGINATION_INVALID = "REST_API_PAGINATION_INVALID",
  /**
   * Org-wide entity-key uniqueness violated. Connector entity keys must
   * be unique per organization so `field_mapping.refEntityKey` resolves
   * unambiguously.
   */
  CONNECTOR_ENTITY_KEY_CONFLICT = "CONNECTOR_ENTITY_KEY_CONFLICT",

  // Large-data-ops — bulk writes (#85)
  /** A non-terminal `bulk_transform` job already locks the target entity. 409. */
  BULK_JOB_TARGET_LOCKED = "BULK_JOB_TARGET_LOCKED",
  /** EXPLAIN of the user expression / source filter failed against PG. 400. */
  BULK_JOB_EXPRESSION_INVALID = "BULK_JOB_EXPRESSION_INVALID",
  /** Agent's `keyField` doesn't match any wide-column on the source. 400. */
  BULK_JOB_KEY_FIELD_INVALID = "BULK_JOB_KEY_FIELD_INVALID",
  /** Source has more records than `MAX_BULK_RECORDS`. 400. */
  BULK_JOB_MAX_RECORDS_EXCEEDED = "BULK_JOB_MAX_RECORDS_EXCEEDED",
  /** A per-batch transaction exceeded its wall-clock budget. */
  BULK_JOB_BATCH_TIMEOUT = "BULK_JOB_BATCH_TIMEOUT",
  /** Job was cancelled by the user; partial results may be present. */
  BULK_JOB_CANCELLED = "BULK_JOB_CANCELLED",
  /** Some records failed validation/upsert; details in `partialFailures`. */
  BULK_JOB_PARTIAL_FAILURE = "BULK_JOB_PARTIAL_FAILURE",

  // Large-data-ops — reads (#85)
  /** The query handle's cached data has expired from Redis (24h TTL). */
  READ_HANDLE_EXPIRED = "READ_HANDLE_EXPIRED",
  /** SSE channel dropped mid-stream. Client should fetch the snapshot. */
  READ_STREAM_INTERRUPTED = "READ_STREAM_INTERRUPTED",
  // PORTAL_SQL_TIMEOUT already declared above (portal SQL surface); reused
  // by the reads track without re-declaration.

  // Large-data-ops — tool dispatch (#85, Phase 4)
  /** `expression.ref` doesn't resolve to a tool in the station's tools. */
  BULK_DISPATCH_TOOL_NOT_FOUND = "BULK_DISPATCH_TOOL_NOT_FOUND",
  /** Tool exists but didn't declare `bulkDispatch` metadata. */
  BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE = "BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE",
  /** `acknowledgeCost: true` was set but server-side enforcement rejected — either no prior
   *  rejection exists for this portal+job-signature, or the user hasn't sent a message
   *  since the prior rejection (the agent retried in the same turn). */
  BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID = "BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID",
  /** Tool declared `costHint: "expensive"` and call didn't set `acknowledgeCost: true`. */
  BULK_DISPATCH_COST_NOT_ACKNOWLEDGED = "BULK_DISPATCH_COST_NOT_ACKNOWLEDGED",
  /** rows-by-id request exceeded the per-call id-count cap. */
  BULK_DISPATCH_TOO_MANY_IDS = "BULK_DISPATCH_TOO_MANY_IDS",

  // Subscription tiers (#172)
  /** The default subscription tier row is not seeded — a 500-class invariant
   *  violation (`resolveTier` cannot fall back). Should be impossible post-seed. */
  TIER_DEFAULT_MISSING = "TIER_DEFAULT_MISSING",

  // Tool cost gate (#169)
  /** Per-minute rate limit for the org's tier exceeded for this cost class. */
  TOOL_USAGE_RATE_LIMITED = "TOOL_USAGE_RATE_LIMITED",
  /** The org's billing-period unit allocation for this cost class is exhausted. */
  TOOL_USAGE_QUOTA_EXCEEDED = "TOOL_USAGE_QUOTA_EXCEEDED",

  // Compute-tool purity (#114)
  /** Compute input (rows resolved from a query handle, or inline rows)
   *  exceeded COMPUTE_MAX_ROWS — too many rows for an in-memory compute. 400. */
  COMPUTE_INPUT_TOO_LARGE = "COMPUTE_INPUT_TOO_LARGE",
  /** A `rows` output declaring `production.onLarge: "error"` exceeded its
   *  inline threshold (#161) — the output mirror of COMPUTE_INPUT_TOO_LARGE. 400. */
  COMPUTE_OUTPUT_TOO_LARGE = "COMPUTE_OUTPUT_TOO_LARGE",

  // Webhook compute scaling (#124)
  /** The webhook read/write token is unknown or malformed. 401. */
  WEBHOOK_READ_TOKEN_INVALID = "WEBHOOK_READ_TOKEN_INVALID",
  /** The webhook read/write token has expired (TTL elapsed or revoked). 401. */
  WEBHOOK_READ_TOKEN_EXPIRED = "WEBHOOK_READ_TOKEN_EXPIRED",
  /** The token is valid but scoped to a different handle/org/mode than the
   *  request targets. 403. */
  WEBHOOK_HANDLE_SCOPE_MISMATCH = "WEBHOOK_HANDLE_SCOPE_MISMATCH",
  /** A webhook returned a `{ resultHandle }` that doesn't resolve to a staged
   *  handle for the caller's org. 400. */
  WEBHOOK_RESULT_HANDLE_INVALID = "WEBHOOK_RESULT_HANDLE_INVALID",
}

/**
 * Default `recommendation` per `ApiCode`, used by error constructors
 * that don't override per call site. Optional — only the codes
 * intended to surface to the agent + UI have entries.
 *
 * Added under #85 for the large-data-ops error envelope work.
 */
export const ApiCodeDefaultRecommendation: Partial<Record<ApiCode, string>> = {
  [ApiCode.BULK_JOB_TARGET_LOCKED]:
    "Wait for the running bulk job to finish, or cancel it before retrying.",
  [ApiCode.BULK_JOB_EXPRESSION_INVALID]:
    "Fix the type / column mismatch in your expression and retry.",
  [ApiCode.BULK_JOB_KEY_FIELD_INVALID]:
    "Use a wide-column name (e.g. `c_id`) listed for the source entity in `## Available Data` or `_meta_columns`. Do not invent friendly names.",
  [ApiCode.BULK_JOB_MAX_RECORDS_EXCEEDED]:
    "Split the operation with a WHERE filter on the source.",
  [ApiCode.BULK_JOB_BATCH_TIMEOUT]:
    "Try a smaller batchSize, or simplify the expression.",
  [ApiCode.BULK_JOB_CANCELLED]:
    "Re-run the job to finish; already-committed records are idempotent.",
  [ApiCode.BULK_JOB_PARTIAL_FAILURE]:
    "Inspect the failed records' source ids and retry, or accept the partial.",
  [ApiCode.READ_HANDLE_EXPIRED]:
    "Re-run the original query to refresh the chart's data.",
  [ApiCode.READ_STREAM_INTERRUPTED]:
    "Reload to refetch the cached snapshot.",
  [ApiCode.PORTAL_SQL_TIMEOUT]:
    "Query exceeded 30s. Try a tighter WHERE filter, a tighter date range, or aggregating the source.",
  [ApiCode.SQL_QUERY_COST_NOT_ACKNOWLEDGED]:
    "This query is expensive and must run as an async job. Tell the user it'll run in the background, then retry with `acknowledgeCost: true` AFTER they reply.",
  [ApiCode.SQL_QUERY_COST_ACKNOWLEDGEMENT_INVALID]:
    "Server rejected the acknowledgement. Either no prior escalation exists for this exact query (call without `acknowledgeCost` first), or the user hasn't replied since the rejection (wait for their message, then retry).",
  [ApiCode.SQL_QUERY_JOB_CANCELLED]:
    "Re-run the query to finish; the scan is read-only and idempotent.",
  [ApiCode.SQL_QUERY_JOB_FAILED]:
    "The background scan failed. Fix the SQL or narrow the query, then retry.",
  [ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID]:
    "Server rejected the acknowledgement. Either no prior cost rejection exists for this exact operation (call without `acknowledgeCost` first), or the user hasn't replied since the rejection (wait for their message, then retry).",
  [ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND]:
    "The named tool isn't available in this station. Verify the tool name and that its toolpack is enabled.",
  [ApiCode.BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE]:
    "The tool exists but isn't bulk-dispatchable. Add a `bulkDispatch` metadata block to its toolpack descriptor.",
  [ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED]:
    "This operation calls a costly tool. Confirm with the user, then retry with `acknowledgeCost: true`.",
  [ApiCode.BULK_DISPATCH_TOO_MANY_IDS]:
    "Too many ids in one request. Split into multiple calls of ≤ 1000 ids each.",
  [ApiCode.COMPUTE_INPUT_TOO_LARGE]:
    "Too many rows for an in-memory compute. Pre-aggregate or sample in SQL — a `GROUP BY` rollup, `… LIMIT n`, or an aggregate `sql_query` — then pass the smaller result.",
  [ApiCode.COMPUTE_OUTPUT_TOO_LARGE]:
    "The tool's output exceeded its inline limit and it is declared to error rather than stage a handle. Narrow the result (aggregate or filter the source) so it fits inline.",
  [ApiCode.WEBHOOK_READ_TOKEN_INVALID]:
    "The read/write token is unknown. Use the `readToken` from the call body's `source` grant, sent as `Authorization: Bearer <token>`.",
  [ApiCode.WEBHOOK_READ_TOKEN_EXPIRED]:
    "The token has expired or the tool call already settled. Tokens are valid only for the duration of the originating webhook call.",
  [ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH]:
    "The token is scoped to a different handle, org, or mode. Read with the read token against the granted handle only.",
  [ApiCode.WEBHOOK_RESULT_HANDLE_INVALID]:
    "The returned `resultHandle` doesn't resolve. Stage output via the write endpoint and return the handle it issued.",
};
