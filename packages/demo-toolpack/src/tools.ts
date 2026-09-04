/**
 * The two demo tools (#510) over the Harborview Supply Co. domain (#508).
 *
 * Both answers are **deterministic** (derived from a hash of the inputs) and
 * **not derivable from the loaded data** — a shipping quote and a credit score
 * come from the "vendor's" system, not from the entity records — which is the
 * whole point of a custom toolpack in the demo. Deterministic output lets
 * `docs/DEMO_ORG.runbook.md` state the expected result.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  capability: Record<string, unknown>;
}

/** The pure-consumer capability shape the contract's subset allows. */
const PURE_VALUE_CAPABILITY = {
  pure: true,
  reads: [],
  writes: [],
  locks: [],
  costHint: "free",
  resultKind: "scalar",
  production: { kind: "value" },
  alwaysAvailable: false,
} as const;

export const TOOLS: ToolDefinition[] = [
  {
    name: "quote_shipping_rate",
    description:
      "Quote a freight shipping rate between two Harborview sites for a given " +
      "weight. Returns the distance, quoted rate (USD), transit days, and " +
      "service level. The rate comes from the carrier's pricing engine — it is " +
      "not stored in the connected data.",
    parameterSchema: {
      type: "object",
      properties: {
        origin_site_id: {
          type: "string",
          description: "Origin site id (e.g. SITE-001).",
        },
        dest_site_id: {
          type: "string",
          description: "Destination site id (e.g. SITE-009).",
        },
        weight_kg: {
          type: "number",
          description: "Shipment weight in kilograms.",
        },
      },
      required: ["origin_site_id", "dest_site_id", "weight_kg"],
    },
    capability: PURE_VALUE_CAPABILITY,
  },
  {
    name: "credit_check",
    description:
      "Run a credit check on a Harborview customer. Returns a credit score " +
      "(300–850), risk band, approval decision, and credit limit (USD) from " +
      "the credit bureau — not stored in the connected data.",
    parameterSchema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "Customer id (e.g. CUST-00042).",
        },
      },
      required: ["customer_id"],
    },
    capability: PURE_VALUE_CAPABILITY,
  },
];

export const METADATA = {
  summary:
    "Harborview Supply Co. vendor tools — deterministic shipping quotes and " +
    "credit checks that answer from external systems, demonstrating a custom " +
    "webhook toolpack in the Portals AI demo.",
  tools: [
    {
      name: "quote_shipping_rate",
      description: "Quote a freight rate between two sites for a weight.",
      examples: [
        {
          title: "Seattle → Atlanta, 250 kg",
          input: {
            origin_site_id: "SITE-001",
            dest_site_id: "SITE-009",
            weight_kg: 250,
          },
          output: {
            distance_miles: 0,
            quoted_rate_usd: 0,
            transit_days: 0,
            service: "ground",
          },
        },
      ],
    },
    {
      name: "credit_check",
      description: "Credit score + approval for a customer.",
      examples: [
        {
          title: "Check CUST-00042",
          input: { customer_id: "CUST-00042" },
          output: {
            credit_score: 0,
            risk_band: "good",
            approved: true,
            credit_limit_usd: 0,
          },
        },
      ],
    },
  ],
};

/** FNV-1a 32-bit hash — small, dependency-free, deterministic. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ShippingQuote {
  origin_site_id: string;
  dest_site_id: string;
  weight_kg: number;
  distance_miles: number;
  quoted_rate_usd: number;
  transit_days: number;
  service: "ground" | "freight";
}

export function quoteShippingRate(input: unknown): ShippingQuote {
  const { origin_site_id, dest_site_id, weight_kg } = (input ?? {}) as {
    origin_site_id?: unknown;
    dest_site_id?: unknown;
    weight_kg?: unknown;
  };
  if (
    typeof origin_site_id !== "string" ||
    typeof dest_site_id !== "string" ||
    typeof weight_kg !== "number" ||
    !Number.isFinite(weight_kg) ||
    weight_kg <= 0
  ) {
    throw new ToolInputError(
      "`origin_site_id` and `dest_site_id` must be strings and `weight_kg` a positive number."
    );
  }
  // Symmetric pseudo-distance so A→B and B→A quote alike.
  const pair = [origin_site_id, dest_site_id].sort().join("|");
  const distance_miles = 50 + (fnv1a(pair) % 2951); // 50..3000
  const quoted_rate_usd = round2(
    25 + distance_miles * 0.012 + weight_kg * 0.35
  );
  const transit_days = Math.max(1, Math.ceil(distance_miles / 500));
  const service = distance_miles > 1500 ? "freight" : "ground";
  return {
    origin_site_id,
    dest_site_id,
    weight_kg,
    distance_miles,
    quoted_rate_usd,
    transit_days,
    service,
  };
}

export interface CreditResult {
  customer_id: string;
  credit_score: number;
  risk_band: "poor" | "fair" | "good" | "excellent";
  approved: boolean;
  credit_limit_usd: number;
}

export function creditCheck(input: unknown): CreditResult {
  const { customer_id } = (input ?? {}) as { customer_id?: unknown };
  if (typeof customer_id !== "string" || customer_id.length === 0) {
    throw new ToolInputError("`customer_id` must be a non-empty string.");
  }
  const credit_score = 300 + (fnv1a(customer_id) % 551); // 300..850
  const risk_band =
    credit_score >= 740
      ? "excellent"
      : credit_score >= 670
        ? "good"
        : credit_score >= 580
          ? "fair"
          : "poor";
  const approved = credit_score >= 620;
  const credit_limit_usd = approved
    ? Math.max(5000, Math.floor((credit_score - 580) / 10) * 1000)
    : 0;
  return { customer_id, credit_score, risk_band, approved, credit_limit_usd };
}

/** Thrown on invalid tool input → surfaced as a 400 by the handler. */
export class ToolInputError extends Error {}

export interface DispatchResult {
  status: number;
  body: unknown;
}

/** Route a `{ tool, input }` runtime call to its implementation. */
export function dispatchTool(tool: unknown, input: unknown): DispatchResult {
  if (typeof tool !== "string") {
    return {
      status: 400,
      body: { error: "Body must include a string `tool` field." },
    };
  }
  try {
    switch (tool) {
      case "quote_shipping_rate":
        return { status: 200, body: quoteShippingRate(input) };
      case "credit_check":
        return { status: 200, body: creditCheck(input) };
      default:
        return { status: 404, body: { error: `Unknown tool "${tool}".` } };
    }
  } catch (err) {
    if (err instanceof ToolInputError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}
