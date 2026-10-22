/**
 * The public subprocessor list (#613) — the third parties that process
 * customer data for the hosted service.
 *
 * One source for every surface that names them: the marketing site's
 * `/security/` page and its privacy policy render this list, and
 * `apps/api/src/__tests__/subprocessor-egress-parity.test.ts` fails CI when an
 * env var the API reads isn't classified against it, so a new third-party
 * integration can't ship without updating what the public is told.
 *
 * Pure data, no imports (`content-purity.test.ts`).
 */

export const SUBPROCESSOR_IDS = [
  "aws",
  "auth0",
  "stripe",
  "google",
  "microsoft",
  "anthropic",
  "tavily",
  "mapbox",
] as const;
export type SubprocessorId = (typeof SUBPROCESSOR_IDS)[number];

export interface Subprocessor {
  id: SubprocessorId;
  name: string;
  /** One sentence, rendered verbatim. */
  purpose: string;
  /**
   * `null` when the service always uses it. Otherwise the condition that
   * brings it into play, rendered as its own sentence — "Used <usedWhen>." —
   * so it is lower-case with no period.
   */
  usedWhen: string | null;
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    id: "aws",
    name: "Amazon Web Services (AWS)",
    purpose:
      "Cloud hosting and storage, in the United States (us-east-1) region where the Service runs.",
    usedWhen: null,
  },
  {
    id: "auth0",
    name: "Auth0",
    purpose: "Identity and authentication (sign-in and account identity).",
    usedWhen: null,
  },
  {
    id: "stripe",
    name: "Stripe",
    purpose: "Payment processing and subscription billing for paid plans.",
    usedWhen: null,
  },
  {
    id: "google",
    name: "Google",
    purpose:
      "OAuth-based connectors such as Google Sheets, within the access you grant.",
    usedWhen: "only for the sources you explicitly connect",
  },
  {
    id: "microsoft",
    name: "Microsoft",
    purpose:
      "OAuth-based connectors such as Microsoft Excel workbooks, within the access you grant.",
    usedWhen: "only for the sources you explicitly connect",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    purpose:
      "The AI model provider behind portal answers; the prompts and context needed to answer your questions are sent to generate a response.",
    usedWhen: null,
  },
  {
    id: "tavily",
    name: "Tavily",
    purpose: "Web search.",
    usedWhen: "when a portal question uses the web-search tool",
  },
  {
    id: "mapbox",
    name: "Mapbox",
    purpose: "Geocoding addresses and coordinates.",
    usedWhen: "when a portal question uses a geocoding tool",
  },
];

export const WEBHOOK_NOT_SUBPROCESSOR_NOTE =
  "Any custom webhook tool you register sends data to the endpoint you host and control; that endpoint is your responsibility, not a Portals AI subprocessor.";

export const RESIDENCY_SUBPROCESSOR_NOTE =
  "This list covers the hosted service. A residency deployment, which runs in your own cloud account, uses the providers you configure for it, and its deployment review record lists them.";
