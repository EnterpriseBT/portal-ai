import { z } from "zod";

/**
 * Response schema the interpretation LLM must conform to for column
 * classification. Consumers validate the model's structured output through
 * this schema before mapping into `ColumnClassification[]`.
 *
 * `confidence` is unconstrained at the schema level — Anthropic's
 * structured-output validator rejects `minimum`/`maximum` on number types,
 * so the [0, 1] contract lives in the prompt and is enforced via a clamp
 * on receipt.
 */
export const ClassifierResponseSchema = z.object({
  classifications: z.array(
    z.object({
      sourceHeader: z.string().min(1),
      columnDefinitionId: z.union([z.string().min(1), z.null()]),
      confidence: z.number(),
      rationale: z.string().optional(),
    })
  ),
});

export type ClassifierResponse = z.infer<typeof ClassifierResponseSchema>;

/**
 * Response schema for the narrow axis-name recommender sub-call. Validates
 * `{ name, confidence }` before mapping into `RecordsAxisNameSuggestion`.
 * See note on `ClassifierResponseSchema` re: unconstrained `confidence`.
 */
export const AxisNameRecommenderResponseSchema = z.object({
  name: z.string().min(1),
  confidence: z.number(),
});

export type AxisNameRecommenderResponse = z.infer<
  typeof AxisNameRecommenderResponseSchema
>;
