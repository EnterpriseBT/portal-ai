import { describe, it, expect } from "@jest/globals";

import { toDbCancellationApiError } from "../../db/request-cancellation.util.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import {
  requestContext,
  type DbCancelReason,
} from "../../utils/request-context.util.js";

/** A 57014 as Drizzle surfaces it: the pg error on `.cause`. */
const cancelled = Object.assign(new Error("Failed query: select 1"), {
  cause: Object.assign(new Error("canceling statement due to user request"), {
    code: "57014",
  }),
});

const inRequest = <T>(reason: DbCancelReason | undefined, fn: () => T): T =>
  requestContext.run(
    {
      log: undefined as never,
      dbCancelPolicy: "before-start",
      dbCancelReason: reason,
      dbStarted: false,
    },
    fn
  );

describe("toDbCancellationApiError (#698)", () => {
  it("maps a 57014 the request instrumentation caused to its typed error", () => {
    const timeout = inRequest("admission_timeout", () =>
      toDbCancellationApiError(cancelled)
    );
    expect(timeout?.status).toBe(503);
    expect(timeout?.code).toBe(ApiCode.DB_ADMISSION_TIMEOUT);

    const gone = inRequest("client_gone", () =>
      toDbCancellationApiError(cancelled)
    );
    expect(gone?.status).toBe(499);
    expect(gone?.code).toBe(ApiCode.REQUEST_ABANDONED);
  });

  it("ignores a 57014 with no request cancel reason (a real statement_timeout) and non-57014 errors", () => {
    expect(
      inRequest(undefined, () => toDbCancellationApiError(cancelled))
    ).toBeUndefined();
    expect(toDbCancellationApiError(cancelled)).toBeUndefined();
    const other = Object.assign(new Error("dup"), { code: "23505" });
    expect(
      inRequest("client_gone", () => toDbCancellationApiError(other))
    ).toBeUndefined();
  });
});
