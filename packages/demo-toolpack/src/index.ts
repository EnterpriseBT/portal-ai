/**
 * Public surface of the demo custom webhook toolpack (#510).
 *
 * `handler` is the Lambda function-URL entry point (the deployed artifact sets
 * `Handler: index.handler`). The tool/signing exports let #509 and tests reuse
 * the same definitions the endpoint serves.
 */

export { handler } from "./handler.js";
export type { FunctionUrlEvent, FunctionUrlResult } from "./handler.js";
export { signingSecrets } from "./handler.js";

export {
  TOOLS,
  METADATA,
  dispatchTool,
  quoteShippingRate,
  creditCheck,
  ToolInputError,
} from "./tools.js";
export type {
  ToolDefinition,
  ShippingQuote,
  CreditResult,
  DispatchResult,
} from "./tools.js";

export { verifySignature, sign, signingPayload } from "./signing.js";
export type {
  SignatureResult,
  SignatureFailure,
  VerifyInput,
} from "./signing.js";
