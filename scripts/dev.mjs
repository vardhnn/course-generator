/**
 * `npm run dev` — the zero-setup path:
 *   1. load .env / .env.local (same precedence as Next itself);
 *   2. if DATABASE_URL points at the embedded local PostgreSQL (or is unset),
 *      boot it (or attach to a running one) and apply any committed
 *      migrations, so a fresh clone works with just `npm install && npm run dev`;
 *   3. if DATABASE_URL points elsewhere (e.g. a real Neon database), the
 *      local helper is skipped entirely and no migrations are applied.
 */
import { execSync, spawn } from "node:child_process";
import nextEnv from "@next/env";
import { LOCAL_DB, ensureLocalDatabase } from "./local-db.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? "";
const usesLocalDb = url === "" || url.startsWith(`postgresql://postgres:postgres@localhost:${LOCAL_DB.port}`);

let pg = null;
if (usesLocalDb) {
  process.stdout.write("Starting local PostgreSQL…\n");
  pg = await ensureLocalDatabase();
  process.stdout.write(`Ready at ${LOCAL_DB.url}\n`);
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = LOCAL_DB.url;
  if (!process.env.DIRECT_URL) process.env.DIRECT_URL = LOCAL_DB.url;

  process.stdout.write("Applying migrations…\n");
  try {
    execSync("npx prisma migrate deploy", { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}

// We own the server only when this process started it — shut it down with us.
const shutdown = async (code = 0) => {
  if (pg) {
    try {
      await pg.stop();
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
};
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const child = spawn(`npx next dev${args.length ? " " + args.join(" ") : ""}`, { stdio: "inherit", shell: true });
child.on("exit", (code) => void shutdown(code ?? 0));
