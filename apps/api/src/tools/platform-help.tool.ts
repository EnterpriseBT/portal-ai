import { z } from "zod";
import { tool } from "ai";
import {
  FAQ_ENTRIES,
  GLOSSARY_ENTRIES,
  HELP_TAB,
  buildHelpUrl,
  contentEntrySlug,
  filterFAQ,
  filterGlossary,
} from "@portalai/core/content";

import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { EntitlementService } from "../services/entitlement.service.js";
import { Tool } from "../types/tools.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "platform-help-tool" });

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

interface StationFindings {
  /** False when the station read failed — the answer degrades, never errors. */
  available: boolean;
  hasPacks: boolean;
  unentitledPacks: string[];
  entityCount: number;
  recordCount: number;
}

type Situation =
  | "no_packs"
  | "no_entities"
  | "no_records"
  | "unentitled_packs"
  | "default";

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
    "thin or empty results. Also reports this station's own setup: connected " +
    "sources, whether records have been imported, and which tool packs are " +
    "enabled or excluded by the plan. Use it whenever the user asks how the " +
    "product works, what they can do here, or why something isn't working. " +
    "**This is not a data-query tool** — it never reads the user's records to " +
    "answer a question about their data; use the data tools for that.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input: z.infer<typeof InputSchema>) => {
        const findings = await gatherFindings(stationId, organizationId);
        const situation = matchSituation(findings);
        const selected = selectContent(input.question);
        return composeAnswer(situation, findings, selected);
      },
    });
  }
}

/**
 * Read what this station can be said about. Fail-soft by contract: any failure
 * degrades the answer instead of erroring, because this is the surface a stuck
 * user reaches for.
 */
async function gatherFindings(
  stationId: string,
  organizationId: string
): Promise<StationFindings> {
  try {
    const repo = DbService.repository;

    const enabledRows = await repo.stationToolpacks.findByStationId(stationId);
    const builtinSlugs = enabledRows
      .map((r: { builtinSlug: string | null }) => r.builtinSlug)
      .filter((s: string | null): s is string => s !== null);
    const customPackIds = enabledRows
      .map(
        (r: { organizationToolpackId: string | null }) =>
          r.organizationToolpackId
      )
      .filter((id: string | null): id is string => id !== null);

    const { unentitled } = await EntitlementService.splitBuiltinPacks(
      organizationId,
      builtinSlugs
    );

    // Org-scoped, exactly as `station_context` reads.
    const stationData = await AnalyticsService.loadStation(
      stationId,
      organizationId
    );
    const entityIds = stationData.entities.map((e: { id: string }) => e.id);

    // One bounded aggregate — never a row scan. A station's entities can be
    // arbitrarily large, and all this answer needs is presence.
    const recordCount =
      entityIds.length > 0
        ? await repo.entityRecords.countByConnectorEntityIds(entityIds)
        : 0;

    return {
      available: true,
      hasPacks: builtinSlugs.length > 0 || customPackIds.length > 0,
      unentitledPacks: unentitled,
      entityCount: entityIds.length,
      recordCount,
    };
  } catch (error) {
    logger.warn(
      { stationId, organizationId, error },
      "platform_help could not read station state; answering without it"
    );
    return {
      available: false,
      hasPacks: true,
      unentitledPacks: [],
      entityCount: 0,
      recordCount: 0,
    };
  }
}

/** First hit wins — ordered from "nothing works" to "everything works". */
function matchSituation(findings: StationFindings): Situation {
  if (!findings.available) return "default";
  if (!findings.hasPacks) return "no_packs";
  if (findings.entityCount === 0) return "no_entities";
  if (findings.recordCount === 0) return "no_records";
  if (findings.unentitledPacks.length > 0) return "unentitled_packs";
  return "default";
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
  no_packs: () =>
    "This station has no tool packs attached, so a portal session on it can " +
    "only talk in generalities. Tool packs are what give the assistant its " +
    "abilities here — querying your data, statistics, charts, maps, and so " +
    "on. Open the station and attach at least the data-query pack, then ask " +
    "again.",
  no_entities: () =>
    "This station has no data connected yet, which is why answers are thin. " +
    "A portal answers from records that have been brought into the station, " +
    "not from general knowledge. Connect a source — a file, a spreadsheet, a " +
    "database, or an API — and its entities will show up on the station.",
  no_records: () =>
    "This station has entities set up, but **no records have been imported " +
    "into them yet** — that is why answers come back empty. The assistant " +
    "answers from imported records rather than from general knowledge, so " +
    "there is nothing for it to read. Run a sync on the connector instance " +
    "and wait for the job to finish, then ask again.",
  unentitled_packs: (f) =>
    `Some tool packs on this station are not included in your current plan (${f.unentitledPacks.join(
      ", "
    )}). They stay attached and nothing was deleted — their tools are simply ` +
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
