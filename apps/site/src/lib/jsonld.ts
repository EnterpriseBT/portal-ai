/**
 * JSON-LD builders (#311).
 *
 * Structured data is the machine-readable half of the page contract: it is
 * what puts prices in a search result and answers in an AI summary. Built
 * from the SAME snapshot the visible page renders, never hand-authored, so
 * the two can't disagree — a rich result advertising a stale price is worse
 * than no rich result.
 */

import type { PublicSiteConfigResponse } from "@portalai/core/contracts";
import { FAQ_ENTRIES } from "@portalai/core/content";

const ORG_NAME = "Portals AI";

export function organizationLd(siteUrl: string, supportEmail: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ORG_NAME,
    url: siteUrl,
    logo: new URL("/og-default.png", siteUrl).href,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: supportEmail,
    },
  };
}

export function webSiteLd(siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: ORG_NAME,
    url: siteUrl,
  };
}

/**
 * `SoftwareApplication` with a real `Offer` per priced tier. Amountless
 * tiers are omitted rather than published as free — a "contact us" plan
 * listed at $0 is a pricing error with legal weight, not a display quirk.
 */
export function softwareApplicationLd(
  siteUrl: string,
  config: PublicSiteConfigResponse
) {
  const offers = config.tiers
    .filter((tier) => tier.price !== null)
    .map((tier) => ({
      "@type": "Offer",
      name: tier.displayName,
      price: (tier.price!.unitAmount / 100).toFixed(2),
      priceCurrency: tier.price!.currency.toUpperCase(),
      category: tier.price!.interval === "year" ? "Annual" : "Monthly",
      url: new URL("/pricing/", siteUrl).href,
    }));

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: ORG_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: siteUrl,
    ...(offers.length > 0 ? { offers } : {}),
  };
}

/** Built from the shared FAQ so the app's Help tab and the public page
 *  answer identically. */
export function faqPageLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ENTRIES.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function breadcrumbLd(
  siteUrl: string,
  trail: Array<{ name: string; path: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: new URL(crumb.path, siteUrl).href,
    })),
  };
}

/** Glossary terms as a `DefinedTermSet` — the vocabulary an AI crawler needs
 *  to describe the product in its own words. */
export function definedTermSetLd(
  siteUrl: string,
  terms: Array<{ term: string; definition: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: `${ORG_NAME} glossary`,
    url: new URL("/features/", siteUrl).href,
    hasDefinedTerm: terms.map((entry) => ({
      "@type": "DefinedTerm",
      name: entry.term,
      description: entry.definition,
    })),
  };
}
