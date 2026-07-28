import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Vercel uses Vinext with Nitro and Build Output API settings", async () => {
  const [viteConfig, packageJson, vercelJson] = await Promise.all([
    rootFile("vite.vercel.config.ts"),
    rootFile("package.json"),
    rootFile("vercel.json"),
  ]);
  assert.match(viteConfig, /vinext\(\)/);
  assert.match(viteConfig, /nitro\(/);
  assert.match(viteConfig, /serverDir:\s*"\.\/nitro\/server"/);
  assert.match(viteConfig, /maxDuration:\s*120/);
  assert.match(viteConfig, /runtime:\s*"nodejs22\.x"/);
  assert.match(packageJson, /NITRO_PRESET=vercel/);
  assert.match(packageJson, /vite\.vercel\.config\.ts/);
  assert.doesNotMatch(vercelJson, /outputDirectory/);
});

test("Vercel API keeps secrets and local execution off the client", async () => {
  const [page, runtime, modelProvider] = await Promise.all([
    rootFile("app/page.tsx"),
    rootFile("server/runtime/vercel.ts"),
    rootFile("server/runtime/model-provider.ts"),
  ]);
  assert.doesNotMatch(page, /DEEPSEEK_API_KEY|DATABASE_URL/);
  assert.match(runtime, /process\.env\.DEEPSEEK_API_KEY/);
  assert.match(runtime, /process\.env\.DATABASE_URL/);
  assert.match(runtime, /python_execution:\s*false/);
  assert.match(runtime, /platformio_execution:\s*false/);
  assert.match(runtime, /physical_hardware_execution:\s*false/);
  assert.match(modelProvider, /explicitProvider === "deepseek"/);
});

test("PostgreSQL schema persists every hosted domain record", async () => {
  const [schema, migration] = await Promise.all([
    rootFile("db/schema.postgres.ts"),
    rootFile("drizzle-postgres/0000_dark_boomerang.sql"),
  ]);
  for (const table of [
    "projects",
    "project_versions",
    "messages",
    "agent_runs",
    "artifacts",
    "validations",
  ]) {
    assert.match(schema, new RegExp(`"${table}"`));
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
});
