/**
 * Domain-specific error class for queue processors and the parsing utilities
 * they delegate to. Carrying a structured `code` lets downstream catch sites
 * (route handlers, SSE event publishers) format user-facing messages without
 * resorting to message-string matching.
 */
export class ProcessorError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProcessorError";
  }
}
