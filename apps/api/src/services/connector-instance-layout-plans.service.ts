/**
 * Service layer for connector-instance layout plans.
 *
 * Orchestrates interpret → persist, fetch-current, and in-place patch.
 * Delegates LLM interpretation to `LayoutPlanInterpretService.analyze` (which wires
 * the parser module's `ClassifierFn` / `AxisNameRecommenderFn` DI slots) and
 * JSONB persistence to `DbService.repository.connectorInstanceLayoutPlans`.
 */

import { and, eq } from "drizzle-orm";

import type {
  InterpretationTrace,
  InterpretRequestBody,
  InterpretResponsePayload,
  LayoutPlan,
  LayoutPlanEditContextResponsePayload,
  LayoutPlanEditContextWorkbookPreview,
  LayoutPlanResponsePayload,
  PatchLayoutPlanBody,
} from "@portalai/core/contracts";
import { LayoutPlanSchema } from "@portalai/core/contracts";
import type { LayoutPlanCommitWorkbookSource } from "@portalai/core/models";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { FileUploadSessionService } from "./file-upload-session.service.js";
import { LayoutPlanInterpretService } from "./layout-plan-interpret.service.js";
import { WorkbookCacheService } from "./workbook-cache.service.js";
import { ApiError } from "./http.service.js";
import { environment } from "../environment.js";
import { SystemUtilities } from "../utils/system.util.js";
import { connectorInstances } from "../db/schema/index.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { db } from "../db/client.js";
import { workbookCacheKey } from "../utils/connector-cache-keys.util.js";
import { inflateSheetPreviewFromChunks } from "../utils/workbook-preview.util.js";

/**
 * Connector slugs whose `resolveWorkbook` path the edit-context endpoint
 * knows how to drive — anything outside this list returns
 * `editable: false` so the UI shows a "not supported" affordance instead
 * of trying to mount the region editor against a workbook source it
 * doesn't understand.
 */
const EDITABLE_SLUGS = new Set([
  "file-upload",
  "google-sheets",
  "microsoft-excel",
]);

export interface LayoutPlanIncludeOptions {
  includeTrace: boolean;
}

export class ConnectorInstanceLayoutPlansService {
  /**
   * Run the parser's `interpret()` against the submitted workbook + hints,
   * persist the result, and return the plan + trace.
   *
   * If a current plan already exists for the connector instance, it is
   * superseded by the newly inserted row (atomic, same transaction).
   */
  static async interpret(
    connectorInstanceId: string,
    organizationId: string,
    userId: string,
    body: InterpretRequestBody
  ): Promise<InterpretResponsePayload> {
    await ConnectorInstanceLayoutPlansService.ensureInstanceInOrg(
      connectorInstanceId,
      organizationId
    );

    let plan: LayoutPlan;
    try {
      plan = await LayoutPlanInterpretService.analyze(
        body.workbook,
        body.regionHints ?? [],
        organizationId,
        userId
      );
    } catch (err) {
      throw new ApiError(
        500,
        ApiCode.LAYOUT_PLAN_INTERPRET_FAILED,
        err instanceof Error ? err.message : "Interpret failed"
      );
    }

    const planId = SystemUtilities.id.v4.generate();
    await DbService.transaction(async (tx) => {
      const current =
        await DbService.repository.connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId(
          connectorInstanceId,
          tx
        );

      await DbService.repository.connectorInstanceLayoutPlans.create(
        {
          id: planId,
          connectorInstanceId,
          planVersion: plan.planVersion,
          revisionTag: null,
          plan,
          interpretationTrace: null,
          supersededBy: null,
          created: Date.now(),
          createdBy: userId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        tx
      );

      if (current) {
        await DbService.repository.connectorInstanceLayoutPlans.supersede(
          current.id,
          planId,
          userId,
          tx
        );
      }
    });

    return { planId, plan, interpretationTrace: null };
  }

  /**
   * Fetch the current (non-superseded, non-deleted) plan for a connector
   * instance. Strips `interpretationTrace` unless the caller opts in.
   */
  static async getCurrent(
    connectorInstanceId: string,
    organizationId: string,
    opts: LayoutPlanIncludeOptions
  ): Promise<LayoutPlanResponsePayload> {
    await ConnectorInstanceLayoutPlansService.ensureInstanceInOrg(
      connectorInstanceId,
      organizationId
    );

    const row =
      await DbService.repository.connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId(
        connectorInstanceId
      );
    if (!row) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        "No layout plan found for this connector instance"
      );
    }

    // `interpretationTrace` is stored as JSONB with a `$type<InterpretationTrace | null>()`
    // declaration on the Drizzle column (asserted in type-checks.ts). The
    // drizzle-zod-derived row type widens to generic JSON; narrow back at the
    // service boundary so the response payload stays strongly typed.
    const trace = (row.interpretationTrace ??
      null) as InterpretationTrace | null;
    return {
      planId: row.id,
      plan: row.plan as LayoutPlan,
      interpretationTrace: opts.includeTrace ? trace : null,
    };
  }

  /**
   * Patch an existing plan row in place. The patch body is merged onto the
   * stored plan (shallow merge at the top level — callers replace nested
   * arrays or objects wholesale) and the merged result is re-validated
   * against `LayoutPlanSchema` before persistence.
   */
  static async patch(
    connectorInstanceId: string,
    planId: string,
    organizationId: string,
    userId: string,
    body: PatchLayoutPlanBody
  ): Promise<LayoutPlanResponsePayload> {
    await ConnectorInstanceLayoutPlansService.ensureInstanceInOrg(
      connectorInstanceId,
      organizationId
    );

    const existing =
      await DbService.repository.connectorInstanceLayoutPlans.findById(planId);
    if (!existing || existing.connectorInstanceId !== connectorInstanceId) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        "Layout plan not found for this connector instance"
      );
    }

    const merged = { ...(existing.plan as LayoutPlan), ...body } as unknown;
    const validated = LayoutPlanSchema.safeParse(merged);
    if (!validated.success) {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
        `Patched plan failed validation: ${validated.error.issues
          .map((i) => i.message)
          .join("; ")}`,
        { issues: validated.error.issues }
      );
    }

    const updated =
      await DbService.repository.connectorInstanceLayoutPlans.update(planId, {
        plan: validated.data,
        planVersion: validated.data.planVersion,
        updated: Date.now(),
        updatedBy: userId,
      });

    if (!updated) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        "Layout plan not found"
      );
    }

    return {
      planId: updated.id,
      plan: updated.plan as LayoutPlan,
      interpretationTrace: null,
    };
  }

  /**
   * Bundle the data the edit view needs at mount time into one round-trip:
   *
   *   - current plan + planId
   *   - connector definition slug (the view dispatches by this to know
   *     which workflow-shaped slice loader to wire up)
   *   - workbook preview (the same envelope the parse / select-sheet
   *     endpoints return today)
   *   - `editable: false` + `reason` when the workbook source is no
   *     longer recoverable (file-upload connectors whose `file_uploads`
   *     rows have been swept, or any connector whose definition slug
   *     isn't in the edit-supported set).
   *
   * The file-upload upload-session lookup walks prior `layout_plan_commit`
   * job metadata for this instance — the `file_uploads` table has no
   * back-reference to `connector_instances`, so job history is the
   * narrowest no-schema-change path. See
   * `docs/EDIT_LAYOUT_PLAN_FLOW.plan.md` §Slice 1 Risk for the trade-off.
   */
  static async getEditContext(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<LayoutPlanEditContextResponsePayload> {
    await ConnectorInstanceLayoutPlansService.ensureInstanceInOrg(
      connectorInstanceId,
      organizationId
    );

    const planRow =
      await DbService.repository.connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId(
        connectorInstanceId
      );
    if (!planRow) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        "No layout plan found for this connector instance"
      );
    }

    const instance =
      await DbService.repository.connectorInstances.findById(
        connectorInstanceId
      );
    // ensureInstanceInOrg already verified the row exists for this org.
    const definition =
      await DbService.repository.connectorDefinitions.findById(
        instance!.connectorDefinitionId
      );
    const slug = definition!.slug;

    const base = {
      planId: planRow.id,
      plan: planRow.plan as LayoutPlan,
      connectorDefinitionSlug: slug,
    } as const;

    if (!EDITABLE_SLUGS.has(slug)) {
      return {
        ...base,
        workbookPreview: null,
        editable: false,
        reason: {
          code: "UNSUPPORTED_CONNECTOR",
          message: `Connector "${slug}" does not support layout-plan editing.`,
        },
      };
    }

    let workbookSource: LayoutPlanCommitWorkbookSource | null = null;
    if (slug === "file-upload") {
      const uploadSessionId =
        await DbService.repository.jobs.findLatestUploadSessionIdForConnectorInstance(
          connectorInstanceId,
          organizationId
        );
      if (uploadSessionId) {
        workbookSource = { kind: "uploadSession", uploadSessionId };
      }
    } else {
      workbookSource = { kind: "connectorInstance", connectorInstanceId };
    }

    if (!workbookSource) {
      return {
        ...base,
        workbookPreview: null,
        editable: false,
        reason: {
          code: "SOURCE_REMOVED",
          message:
            "Source files have been cleaned up — to edit the layout, create a new connector instance.",
        },
      };
    }

    try {
      const workbookPreview =
        await ConnectorInstanceLayoutPlansService.buildEditContextWorkbookPreview(
          workbookSource,
          organizationId,
          slug
        );
      // Echo the upload-session id for file-upload connectors so the
      // frontend's slice loader can route directly to
      // `sdk.fileUploads.sheetSlice` without a second round-trip.
      return {
        ...base,
        workbookPreview,
        editable: true,
        ...(workbookSource.kind === "uploadSession" && {
          uploadSessionId: workbookSource.uploadSessionId,
        }),
      };
    } catch (err) {
      // Cache miss + S3-fallback failure (file_uploads gone or object
      // deleted), or cloud cache never populated — both surface as
      // "source removed" to the editor. Any other error class
      // propagates so the route returns 500 with the underlying message.
      if (
        err instanceof ApiError &&
        (err.code === ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND ||
          err.code === ApiCode.FILE_UPLOAD_FORBIDDEN)
      ) {
        return {
          ...base,
          workbookPreview: null,
          editable: false,
          reason: {
            code: "SOURCE_REMOVED",
            message:
              "Source files have been cleaned up — to edit the layout, create a new connector instance.",
          },
        };
      }
      throw err;
    }
  }

  /**
   * Resolve the chunked-cache prefix for a workbook source, hydrating the
   * file-upload cache on miss (via `FileUploadSessionService.resolveWorkbook`'s
   * S3 fallback), then inflate one `FileUploadParseSheet` per sheet for
   * the editor. The preview envelope matches what the parse path returns,
   * so the editor's existing slice-loader wiring works unchanged.
   */
  private static async buildEditContextWorkbookPreview(
    source: LayoutPlanCommitWorkbookSource,
    organizationId: string,
    slug: string
  ): Promise<LayoutPlanEditContextWorkbookPreview> {
    let prefix: string;
    if (source.kind === "uploadSession") {
      // Side-effect: ensures the cache is populated. Throws
      // FILE_UPLOAD_SESSION_NOT_FOUND when file_uploads rows are gone
      // and FILE_UPLOAD_FORBIDDEN on org-mismatch — both routed to the
      // editable:false branch by the caller.
      await FileUploadSessionService.resolveWorkbook(
        source.uploadSessionId,
        organizationId
      );
      prefix = `upload-session:${source.uploadSessionId}`;
    } else {
      prefix = workbookCacheKey(slug, source.connectorInstanceId);
    }
    const meta = await WorkbookCacheService.getSessionMeta(prefix);
    if (!meta || meta.status !== "ready") {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        "Workbook cache not populated for this connector"
      );
    }
    const inlineCellsMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
    const sheets = [];
    let sliced = false;
    for (const sheetMeta of meta.sheets) {
      const inflated = await inflateSheetPreviewFromChunks(
        prefix,
        sheetMeta,
        inlineCellsMax
      );
      if (inflated.sliced) sliced = true;
      sheets.push(inflated.sheet);
    }
    return sliced ? { sheets, sliced: true } : { sheets };
  }

  /**
   * Org-scoped connector-instance lookup — throws 404 when the instance is
   * missing OR belongs to a different organization. Hides the existence of
   * other orgs' instances from unauthorized callers.
   */
  private static async ensureInstanceInOrg(
    connectorInstanceId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<void> {
    const [row] = await (client as typeof db)
      .select({ id: connectorInstances.id })
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.id, connectorInstanceId),
          eq(connectorInstances.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!row) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance not found for this organization"
      );
    }
  }
}
