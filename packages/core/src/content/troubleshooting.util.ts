/**
 * Troubleshooting entries (#1049): what to do when something in the product
 * goes wrong, phrased the way the user sees it. Pure data, like the FAQ and
 * glossary, rendered by Help's Troubleshooting tab and ranked by help search
 * (`help-search.util.ts`) alongside them.
 *
 * Each entry's `symptom` is its title and slug (`contentEntrySlug`), so it's
 * addressable as `/help?tab=troubleshooting#troubleshooting-entry-<slug>`.
 * Name the permission a refusal needs, never a role (#711): any policy, group
 * or direct grant can give it.
 *
 * Unlike the FAQ, these entries are in-app only. The marketing site doesn't
 * render them: they describe failures in the signed-in product.
 */

export interface TroubleshootingEntry {
  /** What the user sees, as they'd describe it. The entry's title. */
  symptom: string;
  /** Why it happens. */
  cause: string;
  /** What to do about it. */
  fix: string;
  /** FAQ questions or glossary terms that explain more. */
  related?: { surface: "faq" | "glossary"; title: string }[];
  /** Other ways people describe the symptom (#1049 help search). */
  aliases?: string[];
}

export const TROUBLESHOOTING_ENTRIES: TroubleshootingEntry[] = [
  {
    symptom: "I can't add or remove a tag",
    cause:
      "Changing an object's tags is a change to that object, so it needs permission to edit the object. Picking a tag also needs permission to view tags. The assistant's Tags tools follow the same rules.",
    fix: "Ask for edit access to the entity, station, pinned result, connector or view, and for view access to tags. Without view access to tags, an object's tags don't show at all.",
    related: [
      { surface: "faq", title: "How do tags work?" },
      { surface: "glossary", title: "Tag" },
    ],
    aliases: [
      "can't tag",
      "tag picker missing",
      "no add tag",
      "no edit tags button",
      "remove tag",
      "tagging not allowed",
    ],
  },
  {
    symptom: "A sync or import job failed",
    cause:
      "The job couldn't finish reading from the source: the source was unreachable, its sign-in expired, or its columns changed since the connector was set up.",
    fix: "Open Jobs and select the failed job to read its error. Reconnect the connector if its sign-in expired, or update its layout plan if the source's columns changed, then run the sync again.",
    related: [
      { surface: "faq", title: "Why did my job fail?" },
      { surface: "glossary", title: "Job Status" },
    ],
    aliases: ["sync failed", "import failed", "job failed", "sync error"],
  },
  {
    symptom: "An import finished but no records appeared",
    cause:
      "The import ran, but the layout plan's regions matched no rows: for example, the header row moved, or a region points at an empty range.",
    fix: "Open the connector and review its layout plan against the current file. Check each region's range and header row, then commit the plan again.",
    related: [
      { surface: "faq", title: "How do I connect my first data source?" },
      { surface: "glossary", title: "Connector Entity" },
    ],
    aliases: [
      "no records",
      "empty import",
      "nothing showed up",
      "import produced nothing",
      "zero rows",
    ],
  },
  {
    symptom: "It says “You don’t have permission to …”",
    cause:
      "The action needs a permission you haven't been granted on that object. Permissions come from policies, which can be granted to you directly, through a role or through a group.",
    fix: "The message names the permission. Ask someone who can manage access in your organization to grant it, or to share the object with you.",
    related: [
      {
        surface: "faq",
        title: "How do I control who can see and change things?",
      },
      { surface: "glossary", title: "Policy" },
    ],
    aliases: ["permission denied", "not allowed", "access denied", "forbidden"],
  },
  {
    symptom: "A tool pack shows “Not included in your plan”",
    cause:
      "Your organization's plan doesn't include that tool pack, so the assistant can't use it, even though it's attached to the station.",
    fix: "See which plans include it under Settings → Billing, and upgrade there if you can manage billing. Otherwise, detach it from the station.",
    related: [
      {
        surface: "faq",
        title: "Why is a toolpack marked “Inactive on your plan”?",
      },
      { surface: "glossary", title: "Plan Entitlement" },
    ],
    aliases: ["not in my plan", "tool pack inactive", "upgrade to use"],
  },
  {
    symptom: "Actions are paused because a job is running",
    cause:
      "A running job, such as a sync, an import or a revalidation, is writing to that entity or connector. Its data is read-only until the job finishes, so nothing races it.",
    fix: "Wait for the job to finish: the page unlocks on its own. To stop it sooner, open Jobs, select the job and cancel it.",
    related: [
      { surface: "glossary", title: "Data Lock" },
      { surface: "faq", title: "What are jobs?" },
    ],
    aliases: [
      "is running on this entity",
      "locked by a job",
      "entity locked",
      "can't edit while syncing",
    ],
  },
  {
    symptom: "The assistant says I've reached my turn limit",
    cause:
      "Your plan allows a set number of assistant turns per minute and per day, and that limit has been reached.",
    fix: "Wait for the limit to reset (the message says when), or upgrade your plan under Settings → Billing for a higher limit. A question you started from the dashboard isn't lost: the portal is still created, and the question waits in its message box with the limit's notice above it. Send it once the limit resets.",
    related: [
      {
        surface: "faq",
        title: "Is there a limit on how many messages I can send?",
      },
    ],
    aliases: [
      "turn limit",
      "too many messages",
      "rate limit",
      "message limit reached",
      "portal opened without an answer",
      "my question didn't send",
    ],
  },
  {
    symptom: "A portal link says “Portal not found”",
    cause:
      "Portals are private: only the person who started a portal can open it, unless someone has been granted access to portals. A link to someone else's portal answers “not found”, as does one to a portal that was deleted, whose station was deleted, or whose creator left the organization.",
    fix: "Ask the portal's creator to pin the result you need and share the pin with you. To open other people's portals, ask for access to portals (a policy granting read on portals).",
    related: [
      { surface: "glossary", title: "Portal" },
      { surface: "glossary", title: "Portal Result" },
    ],
    aliases: [
      "portal not found",
      "can't open a portal",
      "someone else's portal",
      "portal link doesn't work",
    ],
  },
  {
    symptom: "The command palette doesn't find something",
    cause:
      "The palette only shows items you have access to, in the organization you're working in. It searches stations, pinned results, views, connectors, entities and your own portals by name (an entity also by key), and shows the first few matches of each kind. It doesn't search records, field mappings, column definitions, groups or policies. A # search matches the start of a tag's name, and only tags you can see.",
    fix: "Check you're in the right organization and type more of the name to narrow the matches. For a record or a field, open its entity and search there. If you expected to see the item, ask its owner to share it with you, or ask for access to that kind of item.",
    related: [
      { surface: "glossary", title: "Command Palette" },
      { surface: "glossary", title: "Tag" },
    ],
    aliases: [
      "search doesn't find",
      "can't find in search",
      "missing from search",
      "command palette",
      "ctrl k not working",
    ],
  },
  {
    symptom: "Something couldn't reach the server",
    cause:
      "The app got no answer from the server: your connection dropped, or the service was briefly unavailable. A change may still have been saved if the connection dropped after it was sent.",
    fix: "Check your connection, then reload the page to see the current state. Check whether your change saved before trying it again, so you don't make it twice.",
    aliases: [
      "failed to fetch",
      "network error",
      "server couldn't be reached",
      "connection lost",
      "offline",
    ],
  },
];

/**
 * Entries whose symptom, cause, fix or aliases contain the query, case
 * insensitively. Help's Troubleshooting tab falls back to it while a word is
 * still being typed (help search ranks whole words), like `filterFAQ` and
 * `filterGlossary` for the other tabs.
 */
export function filterTroubleshooting(
  entries: readonly TroubleshootingEntry[],
  opts: { query?: string } = {}
): TroubleshootingEntry[] {
  const q = opts.query?.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) =>
    [e.symptom, e.cause, e.fix, ...(e.aliases ?? [])].some((t) =>
      t.toLowerCase().includes(q)
    )
  );
}
