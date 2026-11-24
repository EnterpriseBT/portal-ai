/**
 * The paraphrase eval for help search (#1049): how real users word questions
 * the help content answers, mapped to the entry that answers them. Each must
 * rank in the top 3. Seeded from portal walk transcripts; add a phrasing
 * whenever a walk or a user finds one that misses, then fix it with an alias
 * (a content edit), not a code change.
 *
 * `expect` is `<surface>:<slug>`, slugged by `contentEntrySlug`.
 */
export const HELP_PARAPHRASES: readonly { query: string; expect: string }[] = [
  {
    query: "How do I bring in a spreadsheet?",
    expect: "faq:how-do-i-connect-my-first-data-source",
  },
  {
    query: "upload a csv file",
    expect: "faq:how-do-i-connect-my-first-data-source",
  },
  { query: "What is a portal?", expect: "glossary:portal" },
  { query: "How do I create a station?", expect: "glossary:station" },
  {
    query: "why can't I see any data",
    expect: "faq:why-are-the-assistant-s-answers-vague-or-missing-my-data",
  },
  {
    // #1049 slice 2: the troubleshooting entry is the more specific answer.
    query: "my sync failed",
    expect: "troubleshooting:a-sync-or-import-job-failed",
  },
  { query: "what made my job fail", expect: "faq:why-did-my-job-fail" },
  {
    query: "how do I add a teammate",
    expect: "faq:how-do-i-invite-someone-to-my-organization",
  },
  {
    query: "how much does it cost to upgrade",
    expect: "faq:how-do-i-upgrade-my-plan",
  },
  {
    query: "save a chart for later",
    expect: "faq:how-do-i-save-results-from-a-portal-session",
  },
  { query: "pin a result", expect: "glossary:pinned-result" },
  { query: "put my data on a map", expect: "faq:can-i-show-my-data-on-a-map" },
  {
    query: "who can see my stuff",
    expect: "faq:how-do-i-control-who-can-see-and-change-things",
  },
  {
    query: "the button is greyed out",
    expect: "faq:why-is-an-action-missing-or-greyed-out-for-me",
  },
  { query: "audit log", expect: "faq:where-can-i-see-who-changed-what" },
  { query: "what's a tool pack", expect: "faq:what-are-tool-packs" },
  {
    query: "message limit",
    expect: "faq:is-there-a-limit-on-how-many-messages-i-can-send",
  },
  {
    query: "refresh my chart with new data",
    expect: "faq:how-do-i-refresh-a-chart-map-or-table-with-the-latest-data",
  },
  {
    query: "what does pending mean for a job",
    expect: "faq:what-do-job-statuses-mean",
  },
  { query: "rename my company", expect: "faq:how-do-i-rename-my-organization" },
  { query: "delete my account", expect: "faq:how-do-i-delete-my-organization" },
  { query: "single sign-on", expect: "glossary:sso" },
  { query: "what is a view", expect: "faq:what-is-a-view" },
  {
    query: "difference between connector and entity",
    expect: "faq:what-s-the-difference-between-a-connector-and-an-entity",
  },
  { query: "how do tags work", expect: "faq:how-do-tags-work" },
  // #1072
  { query: "how do favorites work", expect: "faq:how-do-favorites-work" },
  { query: "star a station", expect: "faq:how-do-favorites-work" },
  { query: "what is a favorite", expect: "glossary:favorite" },
  { query: "write my own tool", expect: "glossary:custom-toolpack" },
  { query: "convert addresses to coordinates", expect: "glossary:geocoding" },
  { query: "who manages billing", expect: "faq:who-can-manage-billing" },
  {
    query: "how should I phrase questions",
    expect: "faq:how-should-i-word-my-questions-to-get-better-answers",
  },
  { query: "what is a role", expect: "glossary:role" },
  {
    query: "share a pinned chart with someone",
    expect: "faq:what-do-people-see-when-i-share-a-pinned-result",
  },
  // #1049 slice 2: troubleshooting
  {
    query: "it says permission denied",
    expect: "troubleshooting:it-says-you-don-t-have-permission-to",
  },
  {
    query: "the import worked but nothing showed up",
    expect: "troubleshooting:an-import-finished-but-no-records-appeared",
  },
  {
    query: "entity is locked by a job",
    expect: "troubleshooting:actions-are-paused-because-a-job-is-running",
  },
  {
    query: "tool pack not included in my plan",
    expect: "troubleshooting:a-tool-pack-shows-not-included-in-your-plan",
  },
  {
    query: "I hit my turn limit",
    expect: "troubleshooting:the-assistant-says-i-ve-reached-my-turn-limit",
  },
  {
    query: "the sync job failed",
    expect: "troubleshooting:a-sync-or-import-job-failed",
  },
];

/** Queries nothing in the help content covers: each must return no match. */
export const HELP_NONSENSE: readonly string[] = [
  "zzzz qqqq",
  "weather in paris",
  "best pizza recipe",
  "asdf jkl",
  "football scores tonight",
  "translate hello to french",
];
