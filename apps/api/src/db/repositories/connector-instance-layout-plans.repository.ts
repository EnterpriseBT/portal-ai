/**
 * Repository for the `connector_instance_layout_plans` table.
 *
 * Persistence layer for versioned `LayoutPlan`s. Each row is one plan
 * revision; `supersededBy` links older rows to their replacement so a
 * connector instance's "current plan" is the row with `supersededBy IS NULL`.
 */

import { and, eq, isNull } from "drizzle-orm";

import { connectorInstanceLayoutPlans } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  ConnectorInstanceLayoutPlanInsert,
  ConnectorInstanceLayoutPlanSelect,
} from "../schema/zod.js";

export class ConnectorInstanceLayoutPlansRepository extends Repository<
  typeof connectorInstanceLayoutPlans,
  ConnectorInstanceLayoutPlanSelect,
  ConnectorInstanceLayoutPlanInsert
> {
  constructor() {
    super(connectorInstanceLayoutPlans);
  }

  /**
   * Fetch the current (non-superseded, non-deleted) plan for a connector
   * instance. Returns `undefined` when no plan has been committed yet.
   *
   * The composite index `cilp_instance_current_idx` backs this lookup.
   */
  async findCurrentByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceLayoutPlanSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(
            connectorInstanceLayoutPlans.connectorInstanceId,
            connectorInstanceId
          ),
          isNull(connectorInstanceLayoutPlans.supersededBy),
          this.notDeleted()
        )
      )
      .limit(1);
    return row as ConnectorInstanceLayoutPlanSelect | undefined;
  }

  /**
   * Fetch every plan revision for a connector instance in insertion order.
   * Includes superseded rows; excludes soft-deleted ones.
   */
  async findByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceLayoutPlanSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(
            connectorInstanceLayoutPlans.connectorInstanceId,
            connectorInstanceId
          ),
          this.notDeleted()
        )
      )) as ConnectorInstanceLayoutPlanSelect[];
  }

  /**
   * Mark an older plan as superseded by a newer one.
   *
   * Sets `oldPlan.supersededBy = newPlanId` and bumps `updated`/`updatedBy`.
   * Returns the updated row, or `undefined` when the old plan is missing or
   * already soft-deleted. No-op if `supersededBy` is already non-null — the
   * caller should treat that as an idempotent success.
   */
  async supersede(
    oldPlanId: string,
    newPlanId: string,
    updatedBy: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceLayoutPlanSelect | undefined> {
    const now = Date.now();
    const [row] = await (client as typeof db)
      .update(this.table)
      .set({
        supersededBy: newPlanId,
        updated: now,
        updatedBy,
      })
      .where(
        and(eq(connectorInstanceLayoutPlans.id, oldPlanId), this.notDeleted())
      )
      .returning();
    return row as ConnectorInstanceLayoutPlanSelect | undefined;
  }
}

export const connectorInstanceLayoutPlansRepo =
  new ConnectorInstanceLayoutPlansRepository();
