import React, { useCallback, useMemo, useRef, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
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
import {
  GLOSSARY_CATEGORY_LABELS,
  GLOSSARY_ENTRIES,
  GlossaryCategory,
  filterGlossary,
  type GlossaryEntry,
} from "../utils/glossary.util";
import {
  FAQ_CATEGORY_LABELS,
  FAQ_ENTRIES,
  FAQCategory,
  filterFAQ,
  type FAQEntry,
} from "../utils/faq.util";

// ── Constants ───────────────────────────────────────────────────────

const TAB_GETTING_STARTED = 0;
const TAB_GLOSSARY = 1;
const TAB_FAQ = 2;

// ── UI props ────────────────────────────────────────────────────────

export interface HelpViewUIProps {
  steps: GettingStartedStep[];
  glossaryEntries: GlossaryEntry[];
  faqEntries: FAQEntry[];
  onNavigate: (route: string) => void;
}

export const HelpViewUI: React.FC<HelpViewUIProps> = ({
  steps,
  glossaryEntries,
  faqEntries,
  onNavigate,
}) => {
  const { tabsProps, getTabProps, getTabPanelProps, value, setValue } =
    useTabs(TAB_GETTING_STARTED);

  const [searchQuery, setSearchQuery] = useState("");
  const [glossaryCategory, setGlossaryCategory] =
    useState<GlossaryCategory | null>(null);
  const [faqCategory, setFaqCategory] = useState<FAQCategory | null>(null);
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
      // Clear filters so the chosen term is guaranteed visible.
      setSearchQuery("");
      setGlossaryCategory(null);
      setValue(TAB_GLOSSARY);

      // Defer scroll until after the tab/list re-renders.
      requestAnimationFrame(() => {
        const el = glossaryEntryRefs.current.get(term.toLowerCase());
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [setValue]
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
        <PageHeader
          title="Help"
          icon={<Icon name={IconName.HelpOutline} />}
        >
          <Typography variant="caption" color="text.secondary">
            For any issues or questions, email{" "}
            <Link href="mailto:ben.turner@btdev.io">
              ben.turner@btdev.io
            </Link>
            .
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
                  onClick={() => setGlossaryCategory(null)}
                />
                {Object.values(GlossaryCategory).map((cat) => (
                  <Chip
                    key={cat}
                    label={GLOSSARY_CATEGORY_LABELS[cat]}
                    color={glossaryCategory === cat ? "primary" : "default"}
                    onClick={() =>
                      setGlossaryCategory(glossaryCategory === cat ? null : cat)
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
                  onClick={() => setFaqCategory(null)}
                />
                {Object.values(FAQCategory).map((cat) => (
                  <Chip
                    key={cat}
                    label={FAQ_CATEGORY_LABELS[cat]}
                    color={faqCategory === cat ? "primary" : "default"}
                    onClick={() =>
                      setFaqCategory(faqCategory === cat ? null : cat)
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

  const handleNavigate = useCallback(
    (route: string) => {
      navigate({ to: route });
    },
    [navigate]
  );

  return (
    <HelpViewUI
      steps={GETTING_STARTED_STEPS}
      glossaryEntries={GLOSSARY_ENTRIES}
      faqEntries={FAQ_ENTRIES}
      onNavigate={handleNavigate}
    />
  );
};
