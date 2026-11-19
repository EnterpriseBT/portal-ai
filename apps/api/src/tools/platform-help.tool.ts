import { z } from "zod";
import { tool } from "ai";
import {
  FAQ_ENTRIES,
  GLOSSARY_ENTRIES,
  HELP_TAB,
  buildHelpUrl,
  contentEntrySlug,
  filterFAQ,
  STATION_ATTACHMENT_MISSING_ACTION,
  STATION_ATTACHMENT_NO_ACCESS_ACTION,
  filterGlossary,
} from "@portalai/core/content";

import {
  StationDiagnosticsService,
  type StationFindings,
  type StationSituation,
} from "../services/station-diagnostics.service.js";
import { Tool } from "../types/tools.js";

type Situation = Exclude<StationSituation, "unknown">;

const InputSchema = z.object({
  question: z
    .string()
    .max(500)
    .optional()
    .describe(
      "The user's question about the product, verbatim. Omit for a general orientation answer."
    ),
});

/** How much shipped content one answer may carry. */
const MAX_FAQ = 3;
const MAX_GLOSSARY = 3;

/**
 * In-session platform help (#367).
 *
 * A **system tool**, not a pack: a pack slug would fall under the per-tier
 * `builtinToolpacks` allowlists, and platform help must never be
 * entitlement-gated or charged. There is deliberately no
 * `builtin-toolpacks.ts` descriptor for it — system tools have no pack mirror,
 * and the registry guard asserts that absence rather than tolerating it.
 *
 * The tool **composes the final prose itself** and the agent relays it. That
 * is the point: platform behavior is what a model states confidently and
 * wrongly, and a wrong answer about the product is worse than no answer. The
 * agent's job here is routing, not authorship.
 */
export class PlatformHelpTool extends Tool<typeof InputSchema> {
  slug = "platform_help";
  name = "Platform Help";
  description =
    "Answer a question about **Portals AI itself** — what portals, stations, " +
    "connectors, entities, tool packs, or pinned results are; how to get " +
    "better answers out of a session; and why this station may be returning " +
    "thin or empty results. Also reports this station's own setup: whether " +
    "views and connectors are attached and whether the user can read them, " +
    "whether records have been imported, and which tool packs are " +
    "enabled or excluded by the plan. Use it whenever the user asks how the " +
    "product works, what they can do here, or why something isn't working. " +
    "**This is not a data-query tool** — it never reads the user's records to " +
    "answer a question about their data; use the data tools for that.";

  get schema() {
    return InputSchema;
  }

  /** #674: `userId` is the caller — the no-access situation is per user. */
  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input: z.infer<typeof InputSchema>) => {
        const findings = await StationDiagnosticsService.forStation(
          stationId,
          organizationId,
          userId
        );
        // `unknown` (the station couldn't be read) answers as `default` did.
        const read = StationDiagnosticsService.situation(findings);
        const situation: Situation = read === "unknown" ? "default" : read;
        const selected = selectContent(input.question);
        return composeAnswer(situation, findings, selected);
      },
    });
  }
}

interface SelectedContent {
  faq: { question: string; answer: string; slug: string }[];
  glossary: { term: string; definition: string; slug: string }[];
}

/**
 * Pick the shipped material this answer quotes. Bounded on purpose — the tool
 * sends a handful of entries, never the corpus.
 */
function selectContent(question?: string): SelectedContent {
  const query = question?.trim();
  if (!query) return { faq: [], glossary: [] };

  return {
    faq: filterFAQ(FAQ_ENTRIES, { query })
      .slice(0, MAX_FAQ)
      .map((e) => ({
        question: e.question,
        answer: e.answer,
        slug: contentEntrySlug(e.question),
      })),
    glossary: filterGlossary(GLOSSARY_ENTRIES, { query })
      .slice(0, MAX_GLOSSARY)
      .map((e) => ({
        term: e.term,
        definition: e.definition,
        slug: contentEntrySlug(e.term),
      })),
  };
}

const SITUATION_PROSE: Record<Situation, (f: StationFindings) => string> = {
  // #848: a station is set up for one kind of work, so this names no one
  // pack as the minimum. Data querying is an example, not a requirement.
  no_packs: () =>
    "This station has no tool packs attached, so a portal session on it can " +
    "only talk in generalities. Tool packs are what give the assistant its " +
    "abilities here — querying your data, statistics, charts, maps, and so " +
    "on. Open the station and attach the packs for what you want to do here, " +
    "such as the data-query pack for questions about your data, then ask " +
    "again.",
  // #674: the sentences come from describeStationAttachmentGaps, shared with
  // the UI alerts and the system prompt, so all three say the same thing.
  attachments_missing: (f) =>
    `${f.attachmentsMissing} ${STATION_ATTACHMENT_MISSING_ACTION}`,
  // #676: the follow-up says the items ARE attached, so a relay can't turn
  // "no access" into "nothing attached".
  attachments_inaccessible: (f) =>
    `${f.attachmentsNoAccess} ${STATION_ATTACHMENT_NO_ACCESS_ACTION}`,
  no_records: () =>
    "This station has entities set up, but **no records have been imported " +
    "into them yet** — that is why answers come back empty. The assistant " +
    "answers from imported records rather than from general knowledge, so " +
    "there is nothing for it to read. Run a sync on the connector instance " +
    "and wait for the job to finish, then ask again.",
  unentitled_packs: (f) =>
    `Some tool packs on this station are not included in your current plan (${f.excludedPacks}). They stay attached and nothing was deleted — their tools are simply ` +
    "absent from portal sessions until the plan includes them again. That is " +
    "a plan limit, not a missing feature.",
  default: () =>
    "A portal is a chat session over the data in a station: ask a question in " +
    "plain language and the assistant answers using the station's records and " +
    "tool packs. You will get the most out of it by asking about one thing at " +
    "a time, and by naming entities and columns the way they appear in your " +
    "data. Results worth keeping can be pinned, and pinned charts and tables " +
    "reload live data when you open them.",
};

function composeAnswer(
  situation: Situation,
  findings: StationFindings,
  selected: SelectedContent
): { answer: string; links: { label: string; url: string }[] } {
  const parts: string[] = [SITUATION_PROSE[situation](findings)];

  // #1045: a plan limit is the last situation matched, so a station with
  // missing data as well never heard about it. It follows whichever answer
  // leads instead.
  if (situation !== "unentitled_packs" && findings.excludedPacks) {
    parts.push(SITUATION_PROSE.unentitled_packs(findings));
  }

  if (!findings.available) {
    parts.push(
      "(I couldn't read this station's current setup just now, so this answer " +
        "is general rather than specific to it.)"
    );
  }

  for (const entry of selected.faq) {
    parts.push(`\n- **${entry.question}** ${entry.answer}`);
  }
  for (const entry of selected.glossary) {
    parts.push(`\n- **${entry.term}** — ${entry.definition}`);
  }

  return { answer: parts.join("\n"), links: buildLinks(selected) };
}

function buildLinks(
  selected: SelectedContent
): { label: string; url: string }[] {
  const links = [
    ...selected.faq.map((e) => ({
      label: e.question,
      url: buildHelpUrl({
        tab: HELP_TAB.faq,
        entry: { surface: "faq" as const, slug: e.slug },
      }),
    })),
    ...selected.glossary.map((e) => ({
      label: e.term,
      url: buildHelpUrl({
        tab: HELP_TAB.glossary,
        entry: { surface: "glossary" as const, slug: e.slug },
      }),
    })),
  ];

  // Always offer the portal material, so even a bare question has somewhere
  // to go.
  links.push({
    label: "Analytics & Portals help",
    url: buildHelpUrl({ tab: HELP_TAB.faq, category: "analytics" }),
  });

  return links;
}
