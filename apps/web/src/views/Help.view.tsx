import React, { useCallback, useMemo, useRef, useState } from "react";

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
import { SUPPORT_MAILTO } from "../utils/tier-format.util";
import {
  GLOSSARY_CATEGORY_LABELS,
  GLOSSARY_ENTRIES,
  GlossaryCategory,
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
  helpTabIndexFromSearch,
  normalizeHelpSearch,
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
  onTabChange: (tab: HelpTab) => void;
  onCategoryChange: (tab: HelpTab, category: HelpCategory | null) => void;
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
  onTabChange,
  onCategoryChange,
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
  const [expandedGlossaryTerm, setExpandedGlossaryTerm] = useState<
    string | null
  >(null);

  const glossaryEntryRefs = useRef<Map<string, HTMLElement>>(new Map());

  const filteredGlossary = useMemo(
    () =>
      filterGlossary(glossaryEntries, {
        query: searchQuery,
        category: glossaryCategory ?? undefined,
      }),
    [glossaryEntries, searchQuery, glossaryCategory]
  );

  const filteredFAQ = useMemo(
    () =>
      filterFAQ(faqEntries, {
        query: searchQuery,
        category: faqCategory ?? undefined,
      }),
    [faqEntries, searchQuery, faqCategory]
  );

  const handleSelectGlossaryTerm = useCallback(
    (term: string) => {
      setExpandedGlossaryTerm(term);
      // Clear filters so the chosen term is guaranteed visible. Switching
      // tabs drops the category param with it, which is the filter clear.
      setSearchQuery("");
      onTabChange(HelpTab.Glossary);

      // Defer scroll until after the tab/list re-renders.
      requestAnimationFrame(() => {
        const el = glossaryEntryRefs.current.get(term.toLowerCase());
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [onTabChange]
  );

  const registerGlossaryEntryRef = useCallback(
    (term: string, el: HTMLElement | null) => {
      const key = term.toLowerCase();
      if (el) {
        glossaryEntryRefs.current.set(key, el);
      } else {
        glossaryEntryRefs.current.delete(key);
      }
    },
    []
  );

  const showSearch = value !== TAB_GETTING_STARTED;

  return (
    <Box>
      <Stack spacing={3}>
        <PageHeader title="Help" icon={<Icon name={IconName.HelpOutline} />}>
          <Typography variant="caption" color="text.secondary">
            For any issues or questions, email{" "}
            <Link href={SUPPORT_MAILTO}>ben.turner@btdev.io</Link>.
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
                  color={glossaryCategory === null ? "primary" : "default"}
                  onClick={() => onCategoryChange(HelpTab.Glossary, null)}
                />
                {Object.values(GlossaryCategory).map((cat) => (
                  <Chip
                    key={cat}
                    label={GLOSSARY_CATEGORY_LABELS[cat]}
                    color={glossaryCategory === cat ? "primary" : "default"}
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
                expandedTerm={expandedGlossaryTerm}
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
                  color={faqCategory === null ? "primary" : "default"}
                  onClick={() => onCategoryChange(HelpTab.Faq, null)}
                />
                {Object.values(FAQCategory).map((cat) => (
                  <Chip
                    key={cat}
                    label={FAQ_CATEGORY_LABELS[cat]}
                    color={faqCategory === cat ? "primary" : "default"}
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
                  groupByCategory={!faqCategory}
                  onSelectTerm={handleSelectGlossaryTerm}
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
  const search = useMemo(() => normalizeHelpSearch(rawSearch), [rawSearch]);

  const tabIndex = helpTabIndexFromSearch(search);
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
      onTabChange={handleTabChange}
      onCategoryChange={handleCategoryChange}
    />
  );
};
