/**
 * Repository for the `commercial_events` table (#176, generalized #568).
 *
 * `insertIfNew` is the atomic webhook dedup gate (D2): a plain
 * INSERT … ON CONFLICT (source, external_id) DO NOTHING, so concurrent
 * deliveries of the same event across instances resolve to exactly one row —
 * the UNIQUE constraint on the pair is the arbiter.
 */

import { commercialEvents } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  CommercialEventSelect,
  CommercialEventInsert,
} from "../schema/zod.js";

export class CommercialEventsRepository extends Repository<
  typeof commercialEvents,
  CommercialEventSelect,
  CommercialEventInsert
> {
  constructor() {
    super(commercialEvents);
  }

  /**
   * Atomic dedup insert. Returns `false` when `(source, external_id)` was
   * already recorded (redelivery / concurrent racer lost) — the caller must
   * then skip all further processing for the event.
   */
  async insertIfNew(
    row: CommercialEventInsert,
    client: DbClient = db
  ): Promise<boolean> {
    const inserted = await (client as typeof db)
      .insert(commercialEvents)
      .values(row)
      .onConflictDoNothing({
        target: [commercialEvents.source, commercialEvents.externalId],
      })
      .returning({ id: commercialEvents.id });
    return inserted.length > 0;
  }
}

/** Singleton instance — import this in services. */
export const commercialEventsRepo = new CommercialEventsRepository();
