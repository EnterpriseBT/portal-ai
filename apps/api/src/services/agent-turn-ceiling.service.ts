import { DbService } from "./db.service.js";
import { TierService } from "./tier.service.js";
import { incrementFixedWindow } from "../utils/rate-limit.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "agent-turn-ceiling" });

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Window + boundary slack, matching the minute window's 2× convention. */
const MINUTE_TTL_SECONDS = 120;
const DAY_TTL_SECONDS = 90_000;

export type TurnAdmission =
  | { allowed: true }
  | {
      allowed: false;
      window: "minute" | "day";
      limit: number;
      retryAfterSeconds: number;
    };

/**
 * Pre-turn admission for the un-charged agent-turn ceiling (#498).
 *
 * Called by the message POST *before* anything is written or streamed, so a
 * denial costs nothing and can never land mid-turn. Turns are NEVER billed —
 * this is an abuse/exposure bound (fixed UTC minute/day windows), sized in
 * `docs/TIER_PRICING_MODEL.md` and carried as tier data
 * (`agentTurnsPerMin`/`agentTurnsPerDay`; null = unlimited).
 *
 * FAIL-OPEN by contract: any infra or tier-resolution failure logs a warn
 * and allows the send — the app never blocks turns on Redis/DB health
 * (un-charged safety bound; the vendor account caps are the last backstop).
 * Increments before comparing, so denied attempts count against the window
 * — they were attempts.
 */
export class AgentTurnCeilingService {
  static async checkAdmission(
    organizationId: string,
    now: number = Date.now()
  ): Promise<TurnAdmission> {
    try {
      const org =
        await DbService.repository.organizations.findById(organizationId);
      if (!org) return { allowed: true }; // shouldn't happen; fail open
      const policy = await TierService.resolveTier(org);
      const { perMin, perDay } = policy.agentTurns;

      if (perMin !== null) {
        const count = await incrementFixedWindow(
          `agent-turns:${organizationId}:min`,
          MINUTE_MS,
          MINUTE_TTL_SECONDS,
          now
        );
        if (count > perMin) {
          return AgentTurnCeilingService.deny(
            organizationId,
            "minute",
            perMin,
            Math.ceil((MINUTE_MS - (now % MINUTE_MS)) / 1000)
          );
        }
      }

      if (perDay !== null) {
        const count = await incrementFixedWindow(
          `agent-turns:${organizationId}:day`,
          DAY_MS,
          DAY_TTL_SECONDS,
          now
        );
        if (count > perDay) {
          return AgentTurnCeilingService.deny(
            organizationId,
            "day",
            perDay,
            Math.ceil((DAY_MS - (now % DAY_MS)) / 1000)
          );
        }
      }

      return { allowed: true };
    } catch (err) {
      logger.warn(
        { err, organizationId },
        "agent-turn admission unavailable; failing open (un-charged safety bound)"
      );
      return { allowed: true };
    }
  }

  private static deny(
    organizationId: string,
    window: "minute" | "day",
    limit: number,
    retryAfterSeconds: number
  ): TurnAdmission {
    logger.warn(
      { organizationId, window, limit },
      "agent turn denied by the tier's send ceiling"
    );
    return { allowed: false, window, limit, retryAfterSeconds };
  }
}
