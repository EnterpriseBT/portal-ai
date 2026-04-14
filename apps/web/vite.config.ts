import path from "path";
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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
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
