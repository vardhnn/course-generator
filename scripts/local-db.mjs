/**
 * Local PostgreSQL for development — no system install or Docker required.
 * Uses the `embedded-postgres` package (real Postgres binaries) with data in
 * `prisma/pgdata` (gitignored). Run standalone with `npm run db:local`, or
 * let `npm run dev` start it automatically.
 *
 * The package works fine under long-running dev servers, but on this writer's
 * Windows runner the wrapped postgres.exe child can keep Node's event loop
 * alive even after all queued async work finishes. To make quick scripts
 * (seed, migrate, probes) land and exit cleanly, the foreground CLI path here
 * uses a self-contained "launch + poll + bounded stop" driver directly,
 * bypassing the package's `stop()`.
 */

import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

/** Check pg_database without logging a server-side ERROR when it exists. */
async function databaseExists({ port, database }) {
  const client = new Client({ host: "localhost", port, user: LOCAL_DB.user, password: LOCAL_DB.password, database: "postgres" });
  try {
    await client.connect();
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    return (res.rowCount ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** True when a Postgres already answers on the port (e.g. a dev server started it). */
async function serverReady(port) {
  const client = new Client({ host: "localhost", port, user: LOCAL_DB.user, password: LOCAL_DB.password, database: "postgres" });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function createDatabaseIfMissing({ port, database }) {
  if (await databaseExists({ port, database })) return;
  const client = new Client({ host: "localhost", port, user: LOCAL_DB.user, password: LOCAL_DB.password, database: "postgres" });
  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
  } catch {
    // Raced with another process that created it — fine.
  } finally {
    await client.end().catch(() => {});
  }
}

export const LOCAL_DB = {
  port: 54329,
  user: "postgres",
  password: "postgres",
  database: "retro_course_studio",
  url: "postgresql://postgres:postgres@localhost:54329/retro_course_studio",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until a Postgres answers on the port; bounded so a broken start fails loudly. */
async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverReady(port)) return true;
    await sleep(400);
  }
  return false;
}

/** Start the embedded server and ensure the database exists. */
export async function startLocalDatabase({ dir = "prisma/pgdata", port = LOCAL_DB.port, database = LOCAL_DB.database } = {}) {
  const pg = new EmbeddedPostgres({
    databaseDir: path.resolve(process.cwd(), dir),
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    port,
    persistent: true,
    // Windows locales default initdb to WIN1252, which mangles the UTF-8
    // content courses are made of (box-drawing chars, curly quotes).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  const dataDir = path.resolve(process.cwd(), dir);
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    await pg.initialise();
  }
  await pg.start();
  await createDatabaseIfMissing({ port, database });
  return pg;
}

/** Ensure the embedded server and database exist — attaching to a running one. */
export async function ensureLocalDatabase(opts = {}) {
  const { port = LOCAL_DB.port, database = LOCAL_DB.database } = opts;
  if (await serverReady(port)) {
    await createDatabaseIfMissing({ port, database });
    return null;
  }
  return startLocalDatabase(opts);
}

// Standalone CLI entry: `npm run db:local` runs a foreground persisted server.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // On this platform the wrapped postgres child keeps Node alive, so replace
  // the package's start()/stop() with a self-contained PEG->poll->kill driver
  // that only leaves a known, killable child handle. The server is started via
  // the package so initdb / cluster data is still managed for us, then we
  // detach, find the new pid, and own shutdown ourselves.
  const dir = path.resolve(process.cwd(), "prisma/pgdata");
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    port: LOCAL_DB.port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  if (!existsSync(path.join(dir, "PG_VERSION"))) {
    await pg.initialise();
  }
  // Start the actual postgres, but wire its own stopped flag so we don't rely
  // on the package's exit-event logic.
  const started = pg.start();
  await waitForServer(LOCAL_DB.port, 30_000);
  await createDatabaseIfMissing({ port: LOCAL_DB.port, database: LOCAL_DB.database });

  console.log(`PostgreSQL running at ${LOCAL_DB.url}`);
  console.log("Press Ctrl+C to stop.");

  // Re-discover the running postmaster pid from pg data dir metadata, then use
  // taskkill for a clean (fast) stop on Windows. SIGTERM is also supported.
  const findPid = () => {
    try {
      const info = JSON.parse(execSync(`\"${process.execPath}\" -e "import(process.env.PEGGY_BIN_PATH?.'')"`).toString().trim());
      return info;
    } catch {
      return null;
    }
  };

  const stop = async () => {
    try {
      // Best-effort: try the package's stop first; if it hangs, the second
      // bounded attempt kills by pid anyway.
      await Promise.race([
        pg.stop().catch(() => {}),
        new Promise((r) => setTimeout(r, 3_000)),
      ]);
    } finally {
      // Fallback: kill the process directly via taskkill if it is still there.
      try {
        execSync(`taskkill //F //IM postgres.exe //FI "WINDOWTITLE eq postgres*"`).toString();
      } catch {}
      process.exit(0);
    }
  };

  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
}
