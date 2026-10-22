/**
 * The `/security/` page's prose outside the controls list (#613), kept here
 * rather than in the `.astro` file so `security-controls.test.ts` can hold it
 * to `FORBIDDEN_CLAIMS` — Astro components aren't unit-tested.
 */

export const DATA_AND_AI_PARAGRAPHS: readonly string[] = [
  "The content you connect to Portals AI is not used to train AI models, ours or anyone else's.",
  "To answer a portal question, we send Anthropic, our AI model provider, the prompt and the context needed to answer it. Anthropic processes it under its commercial API terms, which exclude training on that data, and retains it under its standard API data-retention policy.",
  "A custom webhook tool you register sends data only to the endpoint you host and control.",
  "How long we keep your data, and how to have it deleted, is set out in our privacy policy.",
];

/** The disclosure policy `security.txt`'s `Policy:` field points at. */
export const DISCLOSURE_PARAGRAPHS = (securityEmail: string): string[] => [
  `If you believe you've found a security vulnerability in Portals AI, email ${securityEmail} with a description and the steps to reproduce it.`,
  "We acknowledge every report within 5 business days, keep you informed while we investigate, and fix confirmed vulnerabilities on a severity basis: critical issues within 7 days and high-severity issues within 30 days.",
  "We will not pursue legal action against research done in good faith that avoids privacy violations, data destruction and disruption to the Service, does not access or modify other customers' data, and gives us reasonable time to fix an issue before it is disclosed.",
  "We don't run a paid bug bounty program.",
];
