import { defineCatalog } from "@json-render/core";
import { defineRegistry, schema } from "@json-render/react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import { RegistryEntry } from "../../utils/registry.util.js";
import { CatalogName } from "../../types.js";

export const catalog = defineCatalog(schema, {
  components: {
    Markdown: {
      props: z.object({
        content: z.string().describe("Markdown-formatted text content"),
      }),
      description:
        "Renders markdown content including headings, paragraphs, lists, code blocks, links, and inline formatting",
    },
  },
  actions: {},
});

export const Blog = defineRegistry(catalog, {
  components: {
    Markdown: ({ props }) => {
      return <ReactMarkdown>{props.content}</ReactMarkdown>;
    },
  },
  actions: {},
});

export const BlogEntry: RegistryEntry<CatalogName> = {
  name: CatalogName.Blog,
  definition: Blog,
  catalog,
};
