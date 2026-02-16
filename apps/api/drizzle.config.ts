import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: [
    "./src/db/schema/base.columns.ts",
    "./src/db/schema/user-profiles.table.ts",
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
