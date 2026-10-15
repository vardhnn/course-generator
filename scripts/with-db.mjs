/**
 * `node scripts/with-db.mjs <command…>` — run a command with the local
 * PostgreSQL guaranteed to be up, stopping it again afterwards when this
 * process started it. Used by `npm run seed` / `npm run db:migrate` so a
 * fresh clone works with only `npm install`.
 *
 * When DATABASE_URL points somewhere else (e.g. a real Neon database), the
 * command simply runs — no local server is touched.
 */
import { execSync } from "node:child_process";
import nextEnv from "@next/env";
import { LOCAL_DB, ensureLocalDatabase } from "./local-db.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const command = process.argv.slice(2).join(" ");
if (!command) {
  console.error("usage: node scripts/with-db.mjs <command…>");
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? "";
const usesLocalDb = url === "" || url.startsWith(`postgresql://postgres:postgres@localhost:${LOCAL_DB.port}`);

let started = null;
if (usesLocalDb) {
  process.stdout.write("Starting local PostgreSQL…\n");
  started = await ensureLocalDatabase();
}

let status = 0;
try {
  execSync(command, { stdio: "inherit" });
} catch (error) {
  status = error.status ?? 1;
}

if (started) {
  // Bounded: the package's stop() can hang on Windows when the child's exit
  // event never fires. Leaving the server up is safe — the next run attaches.
  await Promise.race([
    started.stop().catch(() => {}),
    new Promise((r) => setTimeout(r, 5_000)),
  ]);
}
process.exit(status);
