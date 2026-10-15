/**
 * Vitest global setup: a disposable embedded PostgreSQL for the test run.
 * Runs once before any worker spawns; workers inherit these env vars.
 * Tests then `prisma db push --force-reset` against it in beforeAll.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startLocalDatabase } from "../scripts/local-db.mjs";

const TEST_URL = "postgresql://postgres:postgres@localhost:54330/rcs_test";

/**
 * An interrupted run can leave postmaster orphans holding the data directory
 * and its shared-memory block; the next start would then FATAL. Best-effort:
 * kill any postgres.exe still pointing at this directory before initialising.
 */
function killOrphansFor(dir: string) {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
      ],
      { stdio: "ignore" },
    );
  } catch {
    // Nothing matched, or no permission — start() will surface the real error.
  }
}

export default async function setup() {
  killOrphansFor("pgtest");
  rmSync(path.resolve(process.cwd(), "prisma/pgtest"), { force: true, recursive: true });
  const pg = await startLocalDatabase({ dir: "prisma/pgtest", port: 54330, database: "rcs_test" });

  process.env.DATABASE_URL = TEST_URL;
  process.env.DIRECT_URL = TEST_URL;

  return async () => {
    await pg.stop();
    // The postmaster releases file locks asynchronously on Windows; the
    // directory is wiped at the START of the next run instead if this races.
    try {
      rmSync(path.resolve(process.cwd(), "prisma/pgtest"), { force: true, recursive: true });
    } catch {
      // Locked — harmless, next run recreates it.
    }
  };
}
