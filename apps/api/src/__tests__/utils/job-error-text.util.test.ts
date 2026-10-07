import { describe, it, expect } from "@jest/globals";
import { UnrecoverableError } from "bullmq";

import {
  databaseErrorText,
  jobErrorText,
} from "../../utils/job-error-text.util.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

/** A postgres.js-shaped error: wire fields assigned onto the instance. */
function pgError(fields: Record<string, unknown>): Error {
  const err = new Error(String(fields.message ?? "pg error"));
  err.name = "PostgresError";
  return Object.assign(err, { severity: "ERROR", ...fields });
}

/** Drizzle's wrapper: the SQL text and params, with the pg error as cause. */
function drizzleWrapped(cause: Error): Error {
  return new Error(
    'Failed query: insert into "entity_records" ("id","source_id") values ($1,$2)\nparams: rec-1,secret-source',
    { cause }
  );
}

// #719: a job's `error` is read by every org member, so it never carries the
// database's own text (SQL, params, row values); the log keeps all of it.
describe("jobErrorText (#719)", () => {
  it("turns a Drizzle-wrapped unique violation into a data-free sentence", () => {
    const text = jobErrorText(
      drizzleWrapped(
        pgError({
          message:
            'duplicate key value violates unique constraint "uq_entity_records_source"',
          detail: "Key (source_id)=(secret-source) already exists.",
          code: "23505",
          constraint_name: "uq_entity_records_source",
        })
      )
    );
    expect(text).toBe(
      "Database error (unique violation, SQLSTATE 23505). See the server log."
    );
    expect(text).not.toMatch(/secret|uq_entity|insert|Key \(/);
  });

  it("drops a pg message that quotes the bad value", () => {
    const text = jobErrorText(
      pgError({
        message: 'invalid input syntax for type uuid: "secret-value"',
        code: "22P02",
      })
    );
    expect(text).toBe(
      "Database error (invalid input, SQLSTATE 22P02). See the server log."
    );
  });

  // Seen live in the #719 smoke: revalidating an entity whose wide table is gone.
  it("names a missing table", () => {
    expect(
      jobErrorText(
        pgError({
          message: 'relation "er__secret" does not exist',
          code: "42P01",
        })
      )
    ).toBe(
      "Database error (missing table, SQLSTATE 42P01). See the server log."
    );
  });

  it("names an unmapped SQLSTATE generically", () => {
    expect(jobErrorText(pgError({ message: "x", code: "XX000" }))).toBe(
      "Database error (SQLSTATE XX000). See the server log."
    );
  });

  it("scrubs a bare Failed query message with no pg cause", () => {
    const text = jobErrorText(
      new Error('Failed query: select "id" from "jobs"\nparams: secret')
    );
    expect(text).toBe("Database error. See the server log.");
  });

  it("scrubs a re-wrap that embeds Drizzle's message mid-text", () => {
    const text = jobErrorText(
      new Error(
        'pipeline rejected: Failed query: select "id" from "jobs"\nparams: secret'
      )
    );
    expect(text).toBe("Database error. See the server log.");
  });

  // postgres.js connection failures name the database host and port.
  it("scrubs a postgres.js connection error", () => {
    const conn = Object.assign(
      new Error("write CONNECT_TIMEOUT db.internal.prod:5432"),
      { code: "CONNECT_TIMEOUT" }
    );
    expect(jobErrorText(new Error("sync failed", { cause: conn }))).toBe(
      "Database connection error. See the server log."
    );
  });

  // Code review on #719: non-DB errors keep the old formatter's shape.
  it("keeps a numeric code and a detail on a non-database error", () => {
    const sdk = Object.assign(new Error("Request had insufficient scopes"), {
      code: 403,
      detail: "sheets.readonly missing",
    });
    expect(jobErrorText(sdk)).toBe(
      "Request had insufficient scopes | detail: sheets.readonly missing | code: 403"
    );
  });

  it("keeps an upstream network failure's text, as today", () => {
    const socket = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const err = new ApiError(
      502,
      ApiCode.REST_API_FETCH_FAILED,
      "Fetch failed",
      {}
    );
    (err as Error & { cause?: unknown }).cause = socket;
    expect(jobErrorText(err)).toBe("other side closed | code: UND_ERR_SOCKET");
  });

  it("keeps a plain processor error and the stall reason unchanged", () => {
    expect(jobErrorText(new Error("Upload has no rows to import"))).toBe(
      "Upload has no rows to import"
    );
    expect(
      jobErrorText(
        new UnrecoverableError("job stalled more than allowable limit")
      )
    ).toBe("job stalled more than allowable limit");
  });

  it("stringifies a non-Error throw", () => {
    expect(jobErrorText("boom")).toBe("boom");
  });

  it("databaseErrorText is null for a non-database failure", () => {
    expect(databaseErrorText(new Error("provider timed out"))).toBeNull();
  });
});
