/**
 * Minimal type declaration for `sns-validator` (#568) — the AWS SNS message
 * X.509 signature validator, which ships no types of its own.
 */
declare module "sns-validator" {
  type SnsMessage = Record<string, unknown>;
  type ValidateCallback = (err: Error | null, message?: SnsMessage) => void;

  class MessageValidator {
    constructor(options?: {
      encoding?: string;
      maxCerts?: number;
      useCache?: boolean;
    });
    validate(message: SnsMessage, cb: ValidateCallback): void;
  }

  export default MessageValidator;
}
