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
  LayoutPlanResponsePayload,
  PatchLayoutPlanBody,
} from "@portalai/core/contracts";
import { LayoutPlanSchema } from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { LayoutPlanInterpretService } from "./layout-plan-interpret.service.js";
import { ApiError } from "./http.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { connectorInstances } from "../db/schema/index.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { db } from "../db/client.js";

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
