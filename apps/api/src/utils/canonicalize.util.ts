import { createLogger } from "./logger.util.js";

const logger = createLogger({ module: "canonicalize" });

export function canonicalizeString(value: string, canonicalFormat: string): string {
  switch (canonicalFormat) {
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    case "trim":
      return value.trim();
    case "phone": {
      const digits = value.replace(/\D/g, "");
      if (digits.length === 10) return `+1${digits}`;
      return digits;
    }
    default:
      logger.warn({ canonicalFormat }, "Unrecognized canonicalFormat — returning value unchanged");
      return value;
  }
}
