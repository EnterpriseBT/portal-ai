/**
 * Use-case personas (#311).
 *
 * One data module so the index page and each persona page cannot disagree,
 * and so adding a persona is a data edit plus one route file.
 *
 * Grounded in the product's actual surface — connectors, shared column
 * definitions, entity groups, portals, pinned results — rather than generic
 * segments, because the pages have to survive a reader who then opens the
 * app.
 */

export interface UseCase {
  slug: string;
  /** Nav/card label. */
  name: string;
  /** `<h1>` — the reader's problem, not our category. */
  heading: string;
  title: string;
  description: string;
  /** Card blurb on the index page. */
  summary: string;
  /** The situation before Portals AI. */
  problem: string[];
  /** What the product does about it, in product terms. */
  workflow: Array<{ step: string; detail: string }>;
}

export const USE_CASES: UseCase[] = [
  {
    slug: "operations",
    name: "Operations teams",
    heading: "Your numbers are in six places and none of them agree",
    title: "Portals AI for operations teams",
    description:
      "Join your CRM export, billing spreadsheet, and support tool into one shared vocabulary, then ask questions about the combined picture without exporting anything again.",
    summary:
      "Reconcile CRM, billing, and support data that spells the same customer three different ways.",
    problem: [
      "The CRM says one thing, the billing sheet says another, and the reconciliation lives in a spreadsheet somebody rebuilds every month.",
      "Every question that spans two systems turns into an export, a VLOOKUP, and an afternoon.",
      "By the time the numbers agree, they're a week old.",
    ],
    workflow: [
      {
        step: "Connect each system once",
        detail:
          "Upload the spreadsheet, connect the database, point at the REST API. Each connector instance keeps syncing on its own cadence.",
      },
      {
        step: "Map the fields onto one vocabulary",
        detail:
          'Shared column definitions carry types, validation, and canonical formats, so "acct_id", "Account ID", and "customer" resolve to the same thing.',
      },
      {
        step: "Group what belongs together",
        detail:
          "Entity groups link records across sources on a shared field, with an overlap preview before you commit.",
      },
      {
        step: "Ask instead of exporting",
        detail:
          "Open a portal and ask the cross-system question directly. Pin the answer and it stays current.",
      },
    ],
  },
  {
    slug: "founders",
    name: "Founders & operators",
    heading: "You need the number now, not next sprint",
    title: "Portals AI for founders and small teams",
    description:
      "Get answers from your own data without hiring an analyst or waiting on an engineering queue — connect your sources and ask in plain language.",
    summary:
      "Answer your own data questions without an analytics hire or an engineering ticket.",
    problem: [
      "There's no data team, and the person who could write the query is shipping something else.",
      "The dashboards you have answer last quarter's questions, not today's.",
      "Every new question is a favour you have to ask someone.",
    ],
    workflow: [
      {
        step: "Start with what you already have",
        detail:
          "A CSV export is enough to begin. Add the database later; the vocabulary you define carries over.",
      },
      {
        step: "Ask the question you'd have asked a person",
        detail:
          "Portals answer in tables, charts, and prose. Follow-ups keep the context, so you can dig without restating.",
      },
      {
        step: "Pin what you'll want again",
        detail:
          "A pinned result stays live against the underlying data — check it next Monday instead of rebuilding it.",
      },
    ],
  },
  {
    slug: "analysts",
    name: "Analysts",
    heading: "Stop rewriting the same query for other people",
    title: "Portals AI for analysts",
    description:
      "Define the vocabulary once, then let the rest of the team ask their own questions — and extend the agent with your own webhook tools when the built-ins run out.",
    summary:
      "Define the model once, hand the team self-serve questions, and extend the agent with your own tools.",
    problem: [
      "Most of the queue is variations on questions you've already answered.",
      "Every ad-hoc request costs context you wanted to spend on real analysis.",
      "The definitions that matter live in your head and in a hundred saved queries.",
    ],
    workflow: [
      {
        step: "Encode the definitions once",
        detail:
          "Column definitions, validation patterns, and entity groups make the model explicit — and reusable by everyone.",
      },
      {
        step: "Let the team ask directly",
        detail:
          "Portals run against the model you built, so self-serve answers use your definitions rather than inventing new ones.",
      },
      {
        step: "Extend the agent where it stops",
        detail:
          "Register a custom toolpack — your own webhook, your own compute — and the agent can call it like any built-in.",
      },
    ],
  },
];

export const useCaseBySlug = (slug: string): UseCase | undefined =>
  USE_CASES.find((useCase) => useCase.slug === slug);
