import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://placeholder:placeholder@localhost:5432/designer_prototype_agent";

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/schema.postgres.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
