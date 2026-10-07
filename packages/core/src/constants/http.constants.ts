/**
 * #687: the message every API 500 answers with. A 500's own message is
 * whatever the handler caught (often a Drizzle error with the SQL text and its
 * params), so the API keeps it in the log. The web app reads this as "no
 * message" and shows the call site's own fallback instead.
 */
export const INTERNAL_ERROR_MESSAGE = "Internal server error";
