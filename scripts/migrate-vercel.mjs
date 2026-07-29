import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isVercelBuild = process.env.VERCEL === "1";
const migrationUrl =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!migrationUrl) {
  if (isVercelBuild) {
    console.error(
      "[db:migrate] DATABASE_URL is required for a Vercel deployment.",
    );
    process.exit(1);
  }

  console.log(
    "[db:migrate] No PostgreSQL URL in the local process; skipping remote migration.",
  );
  process.exit(0);
}

let parsedUrl;
try {
  parsedUrl = new URL(migrationUrl);
} catch {
  if (isVercelBuild) {
    console.error(
      "[db:migrate] Vercel supplied an invalid PostgreSQL connection URL.",
    );
    process.exit(1);
  }

  console.log(
    "[db:migrate] Local DATABASE_URL is not PostgreSQL; skipping remote migration.",
  );
  process.exit(0);
}

if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
  if (isVercelBuild) {
    console.error(
      "[db:migrate] Vercel DATABASE_URL must use the PostgreSQL protocol.",
    );
    process.exit(1);
  }

  console.log(
    "[db:migrate] Local DATABASE_URL is not PostgreSQL; skipping remote migration.",
  );
  process.exit(0);
}

const drizzleKit = fileURLToPath(
  new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url),
);
const drizzleConfig = fileURLToPath(
  new URL("../drizzle.postgres.config.ts", import.meta.url),
);

console.log(
  "[db:migrate] Applying PostgreSQL migrations with the non-pooled URL when available.",
);

const result = spawnSync(
  process.execPath,
  [drizzleKit, "migrate", "--config", drizzleConfig],
  {
    env: {
      ...process.env,
      DATABASE_URL: migrationUrl,
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[db:migrate] Migration process failed: ${result.error.name}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
