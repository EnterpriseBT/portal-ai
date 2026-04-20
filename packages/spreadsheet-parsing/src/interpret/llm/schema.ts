import { z } from "zod";

/**
 * Response schema the interpretation LLM must conform to for column
 * classification. Consumers validate the model's structured output through
 * this schema before mapping into `ColumnClassification[]`.
 */
export const ClassifierResponseSchema = z.object({
  classifications: z.array(
    z.object({
      sourceHeader: z.string().min(1),
      columnDefinitionId: z.union([z.string().min(1), z.null()]),
      confidence: z.number().min(0).max(1),
      rationale: z.string().optional(),
    })
  ),
});

export type ClassifierResponse = z.infer<typeof ClassifierResponseSchema>;

/**
 * Response schema for the narrow axis-name recommender sub-call. Validates
 * `{ name, confidence }` before mapping into `RecordsAxisNameSuggestion`.
 */
export const AxisNameRecommenderResponseSchema = z.object({
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type AxisNameRecommenderResponse = z.infer<
  typeof AxisNameRecommenderResponseSchema
>;
