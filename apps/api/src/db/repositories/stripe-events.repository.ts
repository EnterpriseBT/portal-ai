/**
 * Repository for the `stripe_events` table (#176).
 *
 * `insertIfNew` is the atomic webhook dedup gate (D2): a plain
 * INSERT … ON CONFLICT (event_id) DO NOTHING, so concurrent deliveries of
 * the same Stripe event across instances resolve to exactly one row —
 * the UNIQUE constraint is the arbiter.
 */

import { stripeEvents } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { StripeEventSelect, StripeEventInsert } from "../schema/zod.js";

export class StripeEventsRepository extends Repository<
  typeof stripeEvents,
  StripeEventSelect,
  StripeEventInsert
> {
  constructor() {
    super(stripeEvents);
  }

  /**
   * Atomic dedup insert. Returns `false` when the event id was already
   * recorded (redelivery / concurrent racer lost) — the caller must then
   * skip all further processing for the event.
   */
  async insertIfNew(
    row: StripeEventInsert,
    client: DbClient = db
  ): Promise<boolean> {
    const inserted = await (client as typeof db)
      .insert(stripeEvents)
      .values(row)
      .onConflictDoNothing({ target: stripeEvents.eventId })
      .returning({ id: stripeEvents.id });
    return inserted.length > 0;
  }
}

/** Singleton instance — import this in services. */
export const stripeEventsRepo = new StripeEventsRepository();
