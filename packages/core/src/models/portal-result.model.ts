import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Portal Result model.
 * Represents a pinned/saved result produced during a portal session —
 * any durable block kind (#312): narrative text, a data-table snapshot,
 * or a re-executable visualization (`d3`, `geo`). Transient kinds
 * (job progress) are deliberately not part of this vocabulary.
 *
 * Sync with the Drizzle `portal_results` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const PortalResultTypeSchema = z.enum([
  "text",
  "data-table",
  "d3",
  "geo",
]);

export type PortalResultType = z.infer<typeof PortalResultTypeSchema>;

export const PortalResultSchema = CoreSchema.extend({
  organizationId: z.string(),
  stationId: z.string(),
  portalId: z.string().nullable(),
  messageId: z.string().nullable(),
  blockIndex: z.number().int().min(0).nullable(),
  name: z.string().min(1),
  type: PortalResultTypeSchema,
  content: z.record(z.string(), z.unknown()),
  /** Epoch ms of the last successful snapshot write — pin time, then each
   *  persist-back refresh (#312). Seeds the web freshness clock. Null on
   *  rows pinned before #312. */
  snapshotUpdatedAt: z.number().int().nullable(),
});

export type PortalResult = z.infer<typeof PortalResultSchema>;

export class PortalResultModel extends CoreModel<PortalResult> {
  get schema() {
    return PortalResultSchema;
  }

  parse(): PortalResult {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<PortalResult> {
    return this.schema.safeParse(this._model);
  }
}

export class PortalResultModelFactory extends ModelFactory<
  PortalResult,
  PortalResultModel
> {
  create(createdBy: string): PortalResultModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const portalResultModel = new PortalResultModel(baseModel.toJSON());
    return portalResultModel;
  }
}
