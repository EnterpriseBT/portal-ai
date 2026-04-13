import { ApplicationRoute } from "./routes.util";

// ── Step shape ──────────────────────────────────────────────────────

export interface GettingStartedStep {
  title: string;
  description: string;
  ctaLabel: string;
  ctaRoute: ApplicationRoute;
}

// ── Steps (audit: connect data → map fields → create station → open portal)

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  {
    title: "Connect a data source",
    description:
      "Pick a connector definition from the catalog — like a CSV upload or a database — and configure it with your file or credentials. The result is a connector instance you can use across stations.",
    ctaLabel: "Go to Connectors",
    ctaRoute: ApplicationRoute.Connectors,
  },
  {
    title: "Map your fields",
    description:
      "Open the entity for your new connection and map each raw field to a shared column definition. Field mappings are what let different sources speak the same vocabulary.",
    ctaLabel: "Go to Entities",
    ctaRoute: ApplicationRoute.Entities,
  },
  {
    title: "Create a station",
    description:
      "Bundle your connector instances together with the tool packs you want to use — data query, statistics, regression, and so on. A station is the workspace a portal runs against.",
    ctaLabel: "Go to Stations",
    ctaRoute: ApplicationRoute.Stations,
  },
  {
    title: "Open a portal",
    description:
      "From your new station, launch a portal session and ask the assistant a question about your data. Pin any results worth keeping so they're one click away on your dashboard.",
    ctaLabel: "Go to Stations",
    ctaRoute: ApplicationRoute.Stations,
  },
];
