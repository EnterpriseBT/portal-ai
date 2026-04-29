import path from "path";
import crypto from "crypto";
import { defineConfig, PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

/**
 * Dev-only plugin that serves catalog packages from source.
 * Maps `/catalogs/<name>` → `../../catalogs/<name>/src/index.tsx`
 * so that Vite transforms and resolves them through its own module graph.
 * The catalog shares the host's React instance — no duplicate bundles.
 */
function serveCatalogs(): PluginOption {
  const catalogsRoot = path.resolve(__dirname, "../../catalogs");

  return {
    name: "serve-catalogs",
    apply: "serve",
    resolveId(source) {
      if (source.startsWith("/catalogs/")) {
        const name = source.replace("/catalogs/", "");
        return path.join(catalogsRoot, name, "/dist/index.js");
      }
    },
  };
}

/**
 * Generates a `version.json` file in the build output with a unique hash.
 * The frontend polls this file to detect new deployments and prompt a reload.
 */
function versionJson(): PluginOption {
  const buildHash = crypto.randomUUID();

  return {
    name: "version-json",
    configureServer(server) {
      server.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-cache");
        res.end(JSON.stringify({ version: buildHash }));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: buildHash }),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    versionJson(),
    serveCatalogs(),
    svgr({
      svgrOptions: {
        exportType: "default",
        ref: true,
        svgo: false,
        titleProp: true,
      },
      include: "**/*.svg",
    }) as PluginOption,
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }) as PluginOption,
    react() as PluginOption,
  ],
  server: {
    port: 3000,
    host: true,
    // OAuth popup connectors (google-sheets et al.) need to be able to read
    // `popup.closed` and receive the postMessage from a cross-origin popup.
    // Default browsers + COOP=same-origin sever the popup reference → the
    // poll loop sees popup.closed=true even while the popup is still open,
    // and rejects the promise prematurely. `same-origin-allow-popups` keeps
    // COOP's protections for everything except popups *we* opened.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
    fs: {
      allow: ["../.."],
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
