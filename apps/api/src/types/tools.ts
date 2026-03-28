import type { ZodType, z } from "zod";

export abstract class Tool<TSchema extends ZodType = ZodType> {
  /** Unique identifier for the tool */
  abstract slug: string;
  /** Human-readable name of the tool */
  abstract name: string;
  /** Description of what the tool does */
  abstract description: string;

  abstract get schema(): TSchema;

  validate(input: unknown): z.infer<TSchema> {
    return this.schema.parse(input);
  }

  abstract build(...args: unknown[]): unknown;
}
