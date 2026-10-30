import { describe, it, expect } from "@jest/globals";

import {
  mergeAttributions,
  toSafeAttribution,
} from "../utils/attribution.util";

import type { AttributionPart } from "../utils/attribution.util";

/** The parts as one string, and whether any of them is a link. */
const text = (parts: AttributionPart[]) => parts.map((p) => p.text).join("");
const links = (parts: AttributionPart[]) =>
  parts.filter((p) => p.href !== undefined);

// CARTO's real TileJSON attribution, as observed on the positron style.
const CARTO =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/about-carto/">CARTO</a>';

describe("toSafeAttribution (#928)", () => {
  it("keeps CARTO's credits, with both links on allow-listed hosts", () => {
    const parts = toSafeAttribution(CARTO);
    expect(text(parts)).toBe("© OpenStreetMap contributors © CARTO");
    expect(links(parts)).toEqual([
      {
        text: "OpenStreetMap",
        href: "https://www.openstreetmap.org/copyright",
      },
      { text: "CARTO", href: "https://carto.com/about-carto/" },
    ]);
  });

  it("passes a plain string through as one text part", () => {
    expect(toSafeAttribution("© OpenStreetMap contributors")).toEqual([
      { text: "© OpenStreetMap contributors" },
    ]);
  });

  it.each([
    ["a <style> element", "HOSTILE<style>body{display:none}</style>"],
    ["an <svg><style>", "HOSTILE<svg><style>body{opacity:0}</style></svg>"],
    [
      "a stylesheet <link>",
      'HOSTILE<link rel="stylesheet" href="https://evil.example/a.css">',
    ],
  ])("drops %s, CSS text included", (_label, html) => {
    const parts = toSafeAttribution(html);
    expect(text(parts)).toBe("HOSTILE");
    expect(links(parts)).toEqual([]);
  });

  it("reduces a phishing form to its text, with no form or input", () => {
    const parts = toSafeAttribution(
      'HOSTILE<form action="https://evil.example">Password <input type="password" name="p"></form>'
    );
    expect(text(parts)).toBe("HOSTILEPassword ");
    expect(links(parts)).toEqual([]);
  });

  it("drops an <img> (no tracking beacon, no handler)", () => {
    expect(
      toSafeAttribution(
        '<img src="https://evil.example/t.gif" onerror="x()">HOSTILE'
      )
    ).toEqual([{ text: "HOSTILE" }]);
  });

  it.each([
    ["a non-allow-listed host", "https://evil.example/login"],
    ["a look-alike host", "https://openstreetmap.org.evil.example/"],
    ["an http: OSM link", "http://www.openstreetmap.org/copyright"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative URL", "/login"],
  ])("turns a link to %s into plain text", (_label, href) => {
    expect(toSafeAttribution(`<a href="${href}">Sign in</a>`)).toEqual([
      { text: "Sign in" },
    ]);
  });

  it("allows subdomains of an allow-listed host", () => {
    expect(
      links(toSafeAttribution('<a href="https://tiles.carto.com/x">CARTO</a>'))
    ).toEqual([{ text: "CARTO", href: "https://tiles.carto.com/x" }]);
  });

  it("keeps the text of markup nested inside an allowed link", () => {
    expect(
      toSafeAttribution(
        '<a href="https://carto.com/"><b>CA</b><style>x{}</style>RTO</a>'
      )
    ).toEqual([{ text: "CARTO", href: "https://carto.com/" }]);
  });

  it("collapses whitespace runs and yields nothing for an empty string", () => {
    // The HTML parser itself drops whitespace before the first text.
    expect(text(toSafeAttribution("  ©\n  Corp   tiles "))).toBe(
      "© Corp tiles "
    );
    expect(toSafeAttribution("")).toEqual([]);
  });
});

describe("mergeAttributions (#928)", () => {
  it("drops empties, duplicates and entries contained in another", () => {
    expect(
      mergeAttributions([
        "",
        "  ",
        "OpenStreetMap</a> contributors",
        CARTO,
        CARTO,
        undefined,
      ])
    ).toEqual([CARTO]);
  });

  it("keeps distinct entries in first-seen order", () => {
    expect(mergeAttributions(["© A", "© B"])).toEqual(["© A", "© B"]);
  });
});
