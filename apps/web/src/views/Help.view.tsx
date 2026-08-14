import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Box,
  Icon,
  IconName,
  PageHeader,
  PageSection,
  Stack,
  Tab,
  TabPanel,
  Tabs,
  Typography,
  useTabs,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";

import { GettingStarted } from "../components/GettingStarted.component";
import { GlossaryList } from "../components/GlossaryList.component";
import { FAQList } from "../components/FAQList.component";
import { HelpSearchBar } from "../components/HelpSearchBar.component";
import {
  GETTING_STARTED_STEPS,
  type GettingStartedStep,
} from "../utils/getting-started.util";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../utils/contact.util";
import {
  GLOSSARY_CATEGORY_LABELS,
  GLOSSARY_ENTRIES,
  GlossaryCategory,
  contentEntrySlug,
  filterGlossary,
  type GlossaryEntry,
  FAQ_CATEGORY_LABELS,
  FAQ_ENTRIES,
  FAQCategory,
  filterFAQ,
  type FAQEntry,
} from "@portalai/core/content";
import { withPageRoutes } from "../utils/glossary-routes.util";
import {
  HelpTab,
  helpAnchorHash,
  helpTabIndexFromSearch,
  normalizeHelpSearch,
  parseHelpAnchor,
  type HelpAnchor,
  type HelpAnchorSurface,
  type HelpCategory,
} from "../utils/routes.util";

// ── Constants ───────────────────────────────────────────────────────

const TAB_GETTING_STARTED = 0;
const TAB_GLOSSARY = 1;
const TAB_FAQ = 2;

/** The shared glossary (`@portalai/core/content`) carries no in-app routes —
 *  they'd be meaningless on the public marketing site. Graft them back on
 *  once at module scope; the dataset is static. */
const GLOSSARY_ENTRIES_WITH_ROUTES = withPageRoutes(GLOSSARY_ENTRIES);

// ── UI props ────────────────────────────────────────────────────────

export interface HelpViewUIProps {
  steps: GettingStartedStep[];
  glossaryEntries: GlossaryEntry[];
  faqEntries: FAQEntry[];
  onNavigate: (route: string) => void;
  /** Resolved tab index (0–2). The URL is the source of truth (#365). */
  tabIndex: number;
  /** Active chip on each tab; `null` is the "All" chip. */
  glossaryCategory: GlossaryCategory | null;
  faqCategory: FAQCategory | null;
  /** Resolved `#<surface>-entry-<slug>` target, if the address named one. */
  anchor: HelpAnchor | null;
  onTabChange: (tab: HelpTab) => void;
  onCategoryChange: (tab: HelpTab, category: HelpCategory | null) => void;
  onNavigateToEntry: (anchor: HelpAnchor) => void;
}

/** Tab index → the slug that addresses it. Inverse of `HELP_TAB_INDEX`. */
const TAB_SLUG_BY_INDEX: Record<number, HelpTab> = {
  [TAB_GETTING_STARTED]: HelpTab.GettingStarted,
  [TAB_GLOSSARY]: HelpTab.Glossary,
  [TAB_FAQ]: HelpTab.Faq,
};

export const HelpViewUI: React.FC<HelpViewUIProps> = ({
  steps,
  glossaryEntries,
  faqEntries,
  onNavigate,
  tabIndex,
  glossaryCategory,
  faqCategory,
  anchor,
  onTabChange,
  onCategoryChange,
  onNavigateToEntry,
}) => {
  const handleTabIndexChange = useCallback(
    (index: number) => {
      const tab = TAB_SLUG_BY_INDEX[index];
      if (tab) onTabChange(tab);
    },
    [onTabChange]
  );

  const { tabsProps, getTabProps, getTabPanelProps, value } = useTabs(
    TAB_GETTING_STARTED,
    { value: tabIndex, onChange: handleTabIndexChange }
  );

  const [searchQuery, setSearchQuery] = useState("");

  /** Open accordions, seeded from the anchor and then owned by the user. */
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(() =>
    anchor ? new Set([anchor.slug]) : new Set()
  );

  // Re-seed only when the anchor itself changes. Seeding on every render would
  // stomp whatever the reader has opened by hand since arriving.
  const lastAnchorKey = useRef<string | null>(
    anchor ? `${anchor.surface}:${anchor.slug}` : null
  );
  const anchorKey = anchor ? `${anchor.surface}:${anchor.slug}` : null;
  if (anchorKey !== lastAnchorKey.current) {
    lastAnchorKey.current = anchorKey;
    if (anchor) {
      setExpandedSlugs((prev) => new Set(prev).add(anchor.slug));
    }
  }

  /** Entry refs across both surfaces, keyed `<surface>-entry-<slug>`. */
  const entryRefs = useRef<Map<string, HTMLElement>>(new Map());

  const handleToggleEntry = useCallback((slug: string) => {
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const registerEntryRef = useCallback(
    (surface: HelpAnchorSurface) => (slug: string, el: HTMLElement | null) => {
      const key = helpAnchorHash({ surface, slug });
      if (el) entryRefs.current.set(key, el);
      else entryRefs.current.delete(key);
    },
    []
  );

  const registerGlossaryEntryRef = useMemo(
    () => registerEntryRef(HelpTab.Glossary),
    [registerEntryRef]
  );
  const registerFaqEntryRef = useMemo(
    () => registerEntryRef(HelpTab.Faq),
    [registerEntryRef]
  );

  // An anchor outranks the category chip: a link that names an entry must not
  // land on a filter that hides it. Same rule the cross-tab jump has always
  // applied by clearing filters before scrolling.
  const effectiveGlossaryCategory =
    anchor?.surface === HelpTab.Glossary ? null : glossaryCategory;
  const effectiveFaqCategory =
    anchor?.surface === HelpTab.Faq ? null : faqCategory;

  const filteredGlossary = useMemo(
    () =>
      filterGlossary(glossaryEntries, {
        query: searchQuery,
        category: effectiveGlossaryCategory ?? undefined,
      }),
    [glossaryEntries, searchQuery, effectiveGlossaryCategory]
  );

  const filteredFAQ = useMemo(
    () =>
      filterFAQ(faqEntries, {
        query: searchQuery,
        category: effectiveFaqCategory ?? undefined,
      }),
    [faqEntries, searchQuery, effectiveFaqCategory]
  );

  // Scroll to the anchored entry once the tab and list have rendered. An
  // anchor naming an entry that no longer exists finds no ref and is a no-op —
  // content churn must not throw at a reader.
  useEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      entryRefs.current
        .get(helpAnchorHash(anchor))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  const handleSelectGlossaryTerm = useCallback(
    (term: string) => {
      // A related-term click and a pasted deep link are the same journey, so
      // they travel the same path: navigate to the entry's address.
      setSearchQuery("");
      onNavigateToEntry({
        surface: HelpTab.Glossary,
        slug: contentEntrySlug(term),
      });
    },
    [onNavigateToEntry]
  );

  const showSearch = value !== TAB_GETTING_STARTED;

  return (
    <Box>
      <Stack spacing={3}>
        <PageHeader title="Help" icon={<Icon name={IconName.HelpOutline} />}>
          <Typography variant="caption" color="text.secondary">
            For any issues or questions, email{" "}
            <Link href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</Link>.
          </Typography>
        </PageHeader>

        <Tabs {...tabsProps} variant="scrollable">
          <Tab label="Getting Started" {...getTabProps(TAB_GETTING_STARTED)} />
          <Tab label="Glossary" {...getTabProps(TAB_GLOSSARY)} />
          <Tab label="FAQ" {...getTabProps(TAB_FAQ)} />
        </Tabs>

        {showSearch && (
          <HelpSearchBar value={searchQuery} onChange={setSearchQuery} />
        )}

        <TabPanel {...getTabPanelProps(TAB_GETTING_STARTED)}>
          <PageSection title="Getting Started" variant="divider">
            <GettingStarted steps={steps} onNavigate={onNavigate} />
          </PageSection>
        </TabPanel>

        <TabPanel {...getTabPanelProps(TAB_GLOSSARY)}>
          <PageSection title="Glossary" variant="divider">
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                rowGap={1}
                flexWrap="wrap"
                data-testid="glossary-category-filters"
              >
                <Chip
                  label="All"
                  color={
                    effectiveGlossaryCategory === null ? "primary" : "default"
                  }
                  onClick={() => onCategoryChange(HelpTab.Glossary, null)}
                />
                {Object.values(GlossaryCategory).map((cat) => (
                  <Chip
                    key={cat}
                    label={GLOSSARY_CATEGORY_LABELS[cat]}
                    color={
                      effectiveGlossaryCategory === cat ? "primary" : "default"
                    }
                    onClick={() =>
                      onCategoryChange(
                        HelpTab.Glossary,
                        glossaryCategory === cat ? null : cat
                      )
                    }
                  />
                ))}
              </Stack>

              <GlossaryList
                entries={filteredGlossary}
                expandedSlugs={expandedSlugs}
                onToggleEntry={handleToggleEntry}
                onSelectTerm={handleSelectGlossaryTerm}
                registerEntryRef={registerGlossaryEntryRef}
              />
            </Stack>
          </PageSection>
        </TabPanel>

        <TabPanel {...getTabPanelProps(TAB_FAQ)}>
          <PageSection title="Frequently Asked Questions" variant="divider">
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                rowGap={1}
                flexWrap="wrap"
                data-testid="faq-category-filters"
              >
                <Chip
                  label="All"
                  color={effectiveFaqCategory === null ? "primary" : "default"}
                  onClick={() => onCategoryChange(HelpTab.Faq, null)}
                />
                {Object.values(FAQCategory).map((cat) => (
                  <Chip
                    key={cat}
                    label={FAQ_CATEGORY_LABELS[cat]}
                    color={effectiveFaqCategory === cat ? "primary" : "default"}
                    onClick={() =>
                      onCategoryChange(
                        HelpTab.Faq,
                        faqCategory === cat ? null : cat
                      )
                    }
                  />
                ))}
              </Stack>

              {filteredFAQ.length === 0 ? (
                <Box
                  data-testid="faq-empty-passthrough"
                  sx={{ py: 4, textAlign: "center" }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No FAQ entries match your search.
                  </Typography>
                </Box>
              ) : (
                <FAQList
                  entries={filteredFAQ}
                  groupByCategory={!effectiveFaqCategory}
                  expandedSlugs={expandedSlugs}
                  onToggleEntry={handleToggleEntry}
                  onSelectTerm={handleSelectGlossaryTerm}
                  registerEntryRef={registerFaqEntryRef}
                />
              )}
            </Stack>
          </PageSection>
        </TabPanel>
      </Stack>
    </Box>
  );
};

// ── Container ───────────────────────────────────────────────────────

export const HelpView: React.FC = () => {
  const navigate = useNavigate();

  // Read the location, then re-normalize (#365). Deliberately not
  // `useSearch({from: "/help"})`: that requires a route match, so the view
  // would crash anywhere it is rendered outside its own route — including the
  // shared test router, which registers no file routes. Reading the raw
  // location and re-applying `normalizeHelpSearch` — the same authority
  // `routes/help.tsx` validates with — keeps both paths in agreement and the
  // component renderable on its own.
  const rawSearch = useRouterState({
    select: (state) => state.location.search as Record<string, unknown>,
  });
  const hash = useRouterState({ select: (state) => state.location.hash });
  const search = useMemo(() => normalizeHelpSearch(rawSearch), [rawSearch]);

  const anchor = useMemo(() => parseHelpAnchor(hash) ?? null, [hash]);

  // The anchor is the most specific address there is, so it selects its own
  // surface — `#faq-entry-x` opens the FAQ tab with or without `?tab=`. That
  // lets a link carry just the fragment (#367 builds these server-side).
  const tabIndex = anchor
    ? helpTabIndexFromSearch({ tab: anchor.surface })
    : helpTabIndexFromSearch(search);
  const glossaryCategory =
    search.tab === HelpTab.Glossary
      ? ((search.category as GlossaryCategory | undefined) ?? null)
      : null;
  const faqCategory =
    search.tab === HelpTab.Faq
      ? ((search.category as FAQCategory | undefined) ?? null)
      : null;

  const handleNavigate = useCallback(
    (route: string) => {
      navigate({ to: route });
    },
    [navigate]
  );

  // `to` is the string literal "/help", not `ApplicationRoute.Help`: an enum
  // member type defeats TanStack's route lookup for search-param inference, so
  // `search` collapses to a params-reducer and every key errors. Same
  // constraint `UpgradeLink.component.tsx` records for "/settings".

  /** A tab change is a destination — it earns a history entry. */
  const handleTabChange = useCallback(
    (tab: HelpTab) => {
      navigate({ to: "/help", search: { tab } });
    },
    [navigate]
  );

  /** Navigating to a single entry is a destination: push, and carry the hash. */
  const handleNavigateToEntry = useCallback(
    (next: HelpAnchor) => {
      navigate({
        to: "/help",
        search: { tab: next.surface },
        hash: helpAnchorHash(next),
      });
    },
    [navigate]
  );

  /** A chip is exploratory — replace, so toggling doesn't spam history. */
  const handleCategoryChange = useCallback(
    (tab: HelpTab, category: HelpCategory | null) => {
      navigate({
        to: "/help",
        search: { tab, category: category ?? undefined },
        replace: true,
      });
    },
    [navigate]
  );

  return (
    <HelpViewUI
      steps={GETTING_STARTED_STEPS}
      glossaryEntries={GLOSSARY_ENTRIES_WITH_ROUTES}
      faqEntries={FAQ_ENTRIES}
      onNavigate={handleNavigate}
      tabIndex={tabIndex}
      glossaryCategory={glossaryCategory}
      faqCategory={faqCategory}
      anchor={anchor}
      onTabChange={handleTabChange}
      onCategoryChange={handleCategoryChange}
      onNavigateToEntry={handleNavigateToEntry}
    />
  );
};
